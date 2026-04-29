import { getSqliteRaw } from "@/lib/db";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = `You are a SQL generator for a SQLite database backing a CRE
business-development dashboard. Generate a single SELECT statement that
answers the user's question. Output ONLY the SQL — no commentary, no markdown
fences, no trailing prose.

## Tables

contacts(id, name, email, phone, direct_phone, mobile_phone, company, title,
  type, business_type, source, tags, city, state, notes, created_at)
  - type ∈ ('buyer','seller','broker','lender','landlord','other')
  - LinkedIn URL is often inside notes as "LinkedIn: https://..."

buildings(id, name, address, city, state, submarket, district,
  property_class, property_subtype, property_size_sf, landlord_name,
  landlord_contact_id, lat, lng, source, notes)
  - property_class ∈ ('A','B','C')

tenants(id, name, industry, credit_rating, parent_company,
  contact_name, contact_email, contact_phone, notes)

leases(id, tenant_id, building_id, document_id, deal_id, property_name,
  property_address, property_city, property_state, property_type,
  suite_unit, floor, square_feet, lease_start_date, lease_end_date,
  months_remaining, rent_psf, effective_rent, annual_rent, lease_type,
  transaction_type, ti_allowance, free_rent_months, escalation_percent,
  options, escalations, is_sublease, tenant_agent, tenant_agency,
  listing_agent, listing_agency, source_file, confidence, notes)
  - months_remaining is an INTEGER (negative = expired N months ago)
  - lease_end_date is an ISO date string 'YYYY-MM-DD'
  - is_sublease is 0/1

deals(id, name, property_type, address, city, state, asking_price, status,
  ai_summary, lat, lng, created_at)
  - status ∈ ('prospect','active','closed','dead')

activities(id, contact_id, deal_id, type, subject, body, date)
  - type ∈ ('call','email','meeting','note')

documents(id, filename, file_type, document_type, property_name,
  property_address, ai_summary, raw_extracted, deal_id, status)

## Rules

1. ALWAYS include LIMIT (default 100) unless the user explicitly asks for "all".
2. JOIN aggressively to surface useful columns. For lease questions, join
   tenants on leases.tenant_id and buildings on leases.building_id, and
   include the tenant's contact info via contacts where contacts.company
   = tenants.name (case+trim insensitive).
3. For "expiring in next N months" → \`leases.months_remaining BETWEEN 0 AND N\`
   (months_remaining is already pre-computed).
4. For "expired" or "past" → \`leases.months_remaining < 0\`.
5. ORDER BY the most natural column (months_remaining ASC for expirations,
   square_feet DESC for size, lease_end_date ASC for date-bound questions).
6. Use SQLite syntax. Date math: \`date('now', '+N months')\`.
7. Return human-friendly column aliases: SELECT t.name AS tenant, ...
8. Never SELECT *. Pick the columns relevant to the question.
9. NEVER use INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/ATTACH/PRAGMA.

## Examples

Q: "all leases expiring in the next 10 months"
A: SELECT t.name AS tenant, t.industry, b.name AS building, b.address, b.city,
     l.suite_unit AS suite, l.square_feet AS sqft, l.lease_end_date AS expires,
     l.months_remaining AS months_left, l.annual_rent, l.rent_psf,
     c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone
   FROM leases l
   INNER JOIN tenants t ON t.id = l.tenant_id
   LEFT JOIN buildings b ON b.id = l.building_id
   LEFT JOIN contacts c ON lower(trim(c.company)) = lower(trim(t.name))
     AND c.type != 'landlord'
   WHERE l.months_remaining BETWEEN 0 AND 10
   ORDER BY l.months_remaining ASC
   LIMIT 100;

Q: "buildings over 100,000 sqft in Carlsbad"
A: SELECT name, address, city, state, property_class, property_subtype,
     property_size_sf, landlord_name
   FROM buildings
   WHERE property_size_sf > 100000 AND lower(city) = 'carlsbad'
   ORDER BY property_size_sf DESC
   LIMIT 100;

Q: "contacts at Sharp Rees-Stealy"
A: SELECT name, title, email, phone, mobile_phone, type
   FROM contacts
   WHERE lower(trim(company)) = lower(trim('Sharp Rees-Stealy'))
   ORDER BY name ASC
   LIMIT 100;
`;

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REPLACE|TRUNCATE|VACUUM)\b/i;

function validateSql(generated: string): { ok: true; sql: string } | { ok: false; reason: string } {
  // Strip markdown fences if Claude added them despite instructions
  let cleaned = generated.trim()
    .replace(/^```sql\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Strip trailing semicolons
  while (cleaned.endsWith(";")) cleaned = cleaned.slice(0, -1).trim();

  if (!/^(SELECT|WITH)\b/i.test(cleaned)) {
    return { ok: false, reason: "query must start with SELECT or WITH" };
  }
  if (FORBIDDEN.test(cleaned)) {
    return { ok: false, reason: "query contains forbidden keyword (DDL/DML)" };
  }

  // Cap rows so a runaway query can't blow up the page.
  if (!/\bLIMIT\s+\d+\b/i.test(cleaned)) {
    cleaned = `${cleaned} LIMIT 1000`;
  }

  return { ok: true, sql: cleaned };
}

export async function POST(request: Request) {
  try {
    const { question } = await request.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question required" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      // Haiku: fast + cheap, totally sufficient for SQL generation against
      // a known schema.
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: SCHEMA,
      messages: [{ role: "user", content: question }],
    });

    const generated = res.content[0]?.type === "text" ? res.content[0].text : "";
    const validated = validateSql(generated);
    if (!validated.ok) {
      return NextResponse.json(
        { error: `SQL validation failed: ${validated.reason}`, generated },
        { status: 400 },
      );
    }

    let rows: Record<string, unknown>[] = [];
    try {
      const stmt = getSqliteRaw().prepare(validated.sql);
      rows = stmt.all() as Record<string, unknown>[];
    } catch (e) {
      return NextResponse.json(
        {
          error: `query execution failed: ${e instanceof Error ? e.message : String(e)}`,
          sql: validated.sql,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      question,
      sql: validated.sql,
      rowCount: rows.length,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ask failed" },
      { status: 500 },
    );
  }
}

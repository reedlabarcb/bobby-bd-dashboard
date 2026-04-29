import { db } from "@/lib/db";
import { contacts, contactEnrichments, tenants } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { searchPeople } from "@/lib/api/apollo";
import { findEmail } from "@/lib/api/hunter";
import { NextResponse } from "next/server";

// Bob's approved decision-maker title filter (no Office Manager, no VP Finance).
const DECISION_MAKER_TITLES = [
  "CEO",
  "President",
  "CFO",
  "COO",
  "VP Real Estate",
  "Head of Real Estate",
  "Director of Real Estate",
  "VP Operations",
];

const MAX_HITS_PER_TENANT = 3;

type ApolloPerson = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string | null;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string; type?: string }>;
  linkedin_url?: string;
  city?: string;
  state?: string;
  organization?: { name?: string; primary_domain?: string };
};

function bestPhone(person: ApolloPerson) {
  const phones = person.phone_numbers || [];
  const mobile = phones.find((p) => (p.type || "").toLowerCase().includes("mobile"));
  const direct = phones.find((p) => (p.type || "").toLowerCase().includes("direct"));
  return {
    phone: phones[0]?.sanitized_number || phones[0]?.raw_number || null,
    mobile: mobile?.sanitized_number || mobile?.raw_number || null,
    direct: direct?.sanitized_number || direct?.raw_number || null,
  };
}

export async function POST(request: Request) {
  try {
    const { tenantId } = await request.json();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Apollo people search at this organization, filtered to decision-maker titles.
    const apolloRaw = (await searchPeople({
      company: tenant.name,
      // Apollo OR's the title list internally — passing all 8 keeps recall high.
    })) as Record<string, unknown>;

    // mixed_people/search returns `people` and `contacts` arrays; we want both.
    const candidates: ApolloPerson[] = [
      ...((apolloRaw.people as ApolloPerson[]) || []),
      ...((apolloRaw.contacts as ApolloPerson[]) || []),
    ];

    // Filter to titles Bob approved. Apollo's title field is freeform — match
    // case-insensitive substring against any approved phrase.
    const wanted = candidates.filter((p) => {
      const title = (p.title || "").toLowerCase();
      return DECISION_MAKER_TITLES.some((t) => title.includes(t.toLowerCase()));
    });

    // Existing contacts at this tenant (by company-name match) to avoid dupes.
    const existing = db
      .select({ name: contacts.name })
      .from(contacts)
      .where(sql`lower(trim(${contacts.company})) = lower(trim(${tenant.name}))`)
      .all();
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

    const created: number[] = [];
    const skipped: string[] = [];

    for (const person of wanted.slice(0, MAX_HITS_PER_TENANT)) {
      const personName = (
        person.name ||
        [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
      );
      if (!personName) continue;

      if (existingNames.has(personName.toLowerCase().trim())) {
        skipped.push(personName);
        continue;
      }

      const { phone, mobile, direct } = bestPhone(person);
      let email = person.email || null;

      // Hunter fallback: if Apollo gave us a name but no email and we have a key, try to find one.
      if (!email && process.env.HUNTER_API_KEY) {
        try {
          const hunter = await findEmail(personName, { company: tenant.name });
          if (hunter.email && hunter.score >= 50) email = hunter.email;
        } catch {
          // Hunter is best-effort here; ignore failures.
        }
      }

      const tagsList = ["decision-maker", "tenant-contact", "apollo-enriched", `tenantId:${tenant.id}`];

      const inserted = db
        .insert(contacts)
        .values({
          name: personName,
          email,
          phone,
          directPhone: direct,
          mobilePhone: mobile,
          company: tenant.name,
          title: person.title || null,
          type: "other",
          source: "apollo-tenant-enrichment",
          sourceFile: `enrich-tenant:${tenant.id}`,
          tags: JSON.stringify(tagsList),
          city: person.city || null,
          state: person.state || null,
          notes: person.linkedin_url ? `LinkedIn: ${person.linkedin_url}` : null,
        })
        .returning({ id: contacts.id })
        .get();

      created.push(inserted.id);

      // Stash the raw Apollo record for later debugging / re-synth.
      db.insert(contactEnrichments)
        .values({
          contactId: inserted.id,
          source: "apollo-tenant-search",
          rawJson: JSON.stringify(person),
        })
        .run();
    }

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      candidatesFound: candidates.length,
      candidatesMatchingTitles: wanted.length,
      createdContactIds: created,
      skippedExisting: skipped,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tenant enrichment failed" },
      { status: 500 },
    );
  }
}

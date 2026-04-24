import { db } from "@/lib/db";
import {
  buildings,
  contacts,
  leases,
  tenants,
  uploads,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

// =========================================================================
// Parsing helpers
// =========================================================================

// Normalize an address for dedup matching. Lowercases, collapses whitespace,
// strips trailing punctuation. Not perfect but covers 80% of variations.
function normAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  return String(addr)
    .trim()
    .toLowerCase()
    .replace(/[.,]+$/g, "")
    .replace(/\s+/g, " ");
}

// Split a cell that may contain one or more people with optional titles in parens.
// Examples:
//   "Robert Stewart (President CEO)"        → [{name: "Robert Stewart", title: "President CEO"}]
//   "Darren D Ceasar (President) - Jamie"   → [{name: "Darren D Ceasar", title: "President"}, {name: "Jamie"}]
//   "Niall Casey (Co Owner) ; Mike Cordoso" → [{name: "Niall Casey", title: "Co Owner"}, {name: "Mike Cordoso"}]
function splitMultiName(raw: string | null | undefined): { name: string; title?: string }[] {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  // Split on ; or space-padded " - " (dash surrounded by spaces — avoids hyphenated names)
  const parts = str.split(/\s*;\s*|\s+-\s+/);
  return parts
    .map((p) => {
      const m = p.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (m) return { name: m[1].trim(), title: m[2].trim() };
      return { name: p.trim() };
    })
    .filter((x) => x.name && x.name.length > 1);
}

// Split broker-list cells like "Tom Van Betten | Aric Starck" or "Agent1 ; Agent2".
function splitBrokers(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/\s*[|;]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s !== "???" && s !== "Unknown");
}

type ParsedPhones = {
  primary: string | null; // first number without a label, best-guess
  direct: string | null;
  mobile: string | null;
};

// Parse "(503) 303-4260 (D) ; (503) 957-9642" → labeled phones.
function parsePhones(raw: string | null | undefined): ParsedPhones {
  const result: ParsedPhones = { primary: null, direct: null, mobile: null };
  if (!raw) return result;
  const parts = String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const labelMatch = p.match(/^(.+?)\s*\(([DMO])\)\s*$/i);
    if (labelMatch) {
      const number = labelMatch[1].trim();
      const tag = labelMatch[2].toUpperCase();
      if (tag === "D" && !result.direct) result.direct = number;
      else if (tag === "M" && !result.mobile) result.mobile = number;
      else if (!result.primary) result.primary = number;
    } else if (!result.primary) {
      result.primary = p;
    }
  }
  if (!result.primary) result.primary = result.direct || result.mobile;
  return result;
}

function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@") && s.includes("."));
}

// Excel dates come through xlsx.js as either a Date object or an ISO string
// depending on cellDates option. Normalize to "YYYY-MM-DD".
function normDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// =========================================================================
// Upsert helpers (dedup strategy per earlier decisions)
// =========================================================================

type RowContext = {
  sourceFile: string;
};

function upsertBuilding(
  row: {
    name: string | null;
    address: string;
    city: string | null;
    propertySizeSf: number | null;
    landlordName: string | null;
  },
  ctx: RowContext
): number {
  const key = normAddr(row.address);
  if (!key) throw new Error("building address required");

  // Lookup by normalized address
  const match = db
    .select()
    .from(buildings)
    .all()
    .find((b) => normAddr(b.address) === key);

  if (match) {
    // Merge: prefer existing non-null values, fill gaps from new row.
    const patch: Partial<typeof buildings.$inferInsert> = {};
    if (!match.name && row.name) patch.name = row.name;
    if (!match.city && row.city) patch.city = row.city;
    if (!match.propertySizeSf && row.propertySizeSf) patch.propertySizeSf = row.propertySizeSf;
    if (!match.landlordName && row.landlordName) patch.landlordName = row.landlordName;
    if (!match.district && row.city) patch.district = row.city;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date().toISOString().replace("T", " ").split(".")[0];
      db.update(buildings).set(patch).where(eq(buildings.id, match.id)).run();
    }
    return match.id;
  }

  const inserted = db
    .insert(buildings)
    .values({
      name: row.name,
      address: row.address,
      city: row.city,
      district: row.city,
      propertySizeSf: row.propertySizeSf,
      landlordName: row.landlordName,
      source: "prospecting-sheet",
      sourceFile: ctx.sourceFile,
    })
    .returning()
    .get();
  return inserted.id;
}

function upsertTenantCompany(name: string): number {
  const existing = db.select().from(tenants).where(eq(tenants.name, name)).get();
  if (existing) return existing.id;
  const inserted = db.insert(tenants).values({ name }).returning().get();
  return inserted.id;
}

type ContactInput = {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  directPhone?: string | null;
  mobilePhone?: string | null;
  company?: string | null;
  type: "buyer" | "seller" | "broker" | "lender" | "other";
  tags?: string[];
};

function upsertContact(input: ContactInput, ctx: RowContext): number {
  // Match by email first
  let match: typeof contacts.$inferSelect | null = null;
  if (input.email) {
    match = db.select().from(contacts).where(eq(contacts.email, input.email)).get() ?? null;
  }
  // Fall back to (name, company)
  if (!match && input.company) {
    match =
      db
        .select()
        .from(contacts)
        .where(and(eq(contacts.name, input.name), eq(contacts.company, input.company)))
        .get() ?? null;
  }

  const tagsJson = input.tags && input.tags.length ? JSON.stringify(input.tags) : null;

  if (match) {
    const patch: Partial<typeof contacts.$inferInsert> = {};
    // Fill gaps only — don't overwrite existing values
    if (!match.title && input.title) patch.title = input.title;
    if (!match.email && input.email) patch.email = input.email;
    if (!match.phone && input.phone) patch.phone = input.phone;
    if (!match.directPhone && input.directPhone) patch.directPhone = input.directPhone;
    if (!match.mobilePhone && input.mobilePhone) patch.mobilePhone = input.mobilePhone;
    if (!match.company && input.company) patch.company = input.company;
    // Merge tags (add any new ones)
    if (tagsJson) {
      const existing = match.tags ? JSON.parse(match.tags) : [];
      const merged = Array.from(new Set([...existing, ...(input.tags || [])]));
      patch.tags = JSON.stringify(merged);
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date().toISOString().replace("T", " ").split(".")[0];
      db.update(contacts).set(patch).where(eq(contacts.id, match.id)).run();
    }
    return match.id;
  }

  const inserted = db
    .insert(contacts)
    .values({
      name: input.name,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      directPhone: input.directPhone ?? null,
      mobilePhone: input.mobilePhone ?? null,
      company: input.company ?? null,
      type: input.type,
      tags: tagsJson,
      source: `Import: ${ctx.sourceFile}`,
      sourceFile: ctx.sourceFile,
    })
    .returning()
    .get();
  return inserted.id;
}

function upsertLease(
  lease: typeof leases.$inferInsert,
  key: { tenantId: number; buildingId: number; startDate: string | null }
): number {
  // Idempotency: if (tenant, building, start date) already exists, update.
  const existing = db
    .select()
    .from(leases)
    .where(
      and(
        eq(leases.tenantId, key.tenantId),
        eq(leases.buildingId, key.buildingId),
        key.startDate
          ? eq(leases.leaseStartDate, key.startDate)
          : sql`lease_start_date IS NULL`
      )
    )
    .all()[0];

  if (existing) {
    db.update(leases).set(lease).where(eq(leases.id, existing.id)).run();
    return existing.id;
  }
  const inserted = db.insert(leases).values(lease).returning().get();
  return inserted.id;
}

// =========================================================================
// Column mapper — Centerpoint Prospecting schema
// =========================================================================

type Row = Record<string, unknown>;

function str(r: Row, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return null;
}

// =========================================================================
// Endpoint
// =========================================================================

export async function POST(request: Request) {
  try {
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const headerSecret = request.headers.get("x-upload-secret");
      if (!headerSecret || headerSecret !== serverSecret) {
        return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const ctx: RowContext = { sourceFile: file.name };
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });

    const upload = db
      .insert(uploads)
      .values({ filename: file.name, fileType: "excel", status: "processing" })
      .returning()
      .get();

    const stats = {
      sheets: 0,
      rowsProcessed: 0,
      rowsSkipped: 0,
      buildingsCreated: 0,
      buildingsUpdated: 0,
      tenantsCreated: 0,
      leasesInserted: 0,
      leasesUpdated: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
      errors: [] as string[],
    };

    // Snapshot existing counts to compute deltas
    const countOf = (table: typeof buildings | typeof tenants | typeof leases | typeof contacts): number => {
      const r = db.select({ c: sql<number>`count(*)` }).from(table).get();
      return Number(r?.c ?? 0);
    };
    const beforeBuildings = countOf(buildings);
    const beforeTenants = countOf(tenants);
    const beforeLeases = countOf(leases);
    const beforeContacts = countOf(contacts);

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: Row[] = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (rows.length === 0) continue;
      stats.sheets++;

      for (const row of rows) {
        try {
          // Required: address
          const address = str(row, "Address", "address");
          if (!address) {
            stats.rowsSkipped++;
            continue;
          }

          const propertyName = str(row, "Property Name", "property_name", "Building Name");
          const city = str(row, "CITY", "City", "city");
          const propertySize = toInt(str(row, "Property Size", "property_size"));
          const lessor = str(row, "Lessor", "Landlord");
          const tenantAgency = str(row, "Tenant Agency");
          const listingAgency = str(row, "Listing Agency");

          // 1. Building
          const buildingId = upsertBuilding(
            {
              name: propertyName,
              address,
              city,
              propertySizeSf: propertySize,
              landlordName: lessor,
            },
            ctx
          );

          // 2. Tenant company (if present)
          const tenantName = str(row, "Tenant");
          if (!tenantName) {
            stats.rowsSkipped++;
            continue;
          }
          const tenantId = upsertTenantCompany(tenantName);

          // 3. Lease
          const startDate = normDate(row["Signed Date"] ?? row["signed_date"]);
          const endDate = normDate(row["End Date"] ?? row["end_date"]);
          const areaLeased = toInt(str(row, "Area Leased"));
          const floor = str(row, "Floor");
          const suite = str(row, "Suite");
          const transactionType = str(row, "Lease Transaction Type");
          const tenantAgentRaw = str(row, "Tenant Agent(s)");
          const listingAgentRaw = str(row, "Listing Agent(s)");
          const notes = str(row, "Notes");

          let monthsRemaining: number | null = null;
          if (endDate) {
            const end = new Date(endDate);
            const now = new Date();
            if (!isNaN(end.getTime())) monthsRemaining = monthsBetween(now, end);
          }

          upsertLease(
            {
              tenantId,
              buildingId,
              propertyName,
              propertyAddress: address,
              propertyCity: city,
              propertyState: "CA",
              suiteUnit: suite,
              floor,
              squareFeet: areaLeased,
              leaseStartDate: startDate,
              leaseEndDate: endDate,
              monthsRemaining,
              transactionType,
              tenantAgent: tenantAgentRaw,
              tenantAgency,
              listingAgent: listingAgentRaw,
              listingAgency,
              notes,
              sourceFile: ctx.sourceFile,
              confidence: "high", // manually curated
            },
            { tenantId, buildingId, startDate }
          );

          // 4. Contacts — tenant decision-maker(s)
          const people = splitMultiName(str(row, "Tenant Contact"));
          const emails = splitEmails(str(row, "Email"));
          const phones = parsePhones(str(row, "Contact Information"));

          people.forEach((person, i) => {
            upsertContact(
              {
                name: person.name,
                title: person.title ?? null,
                email: emails[i] ?? null,
                phone: phones.primary,
                directPhone: phones.direct,
                mobilePhone: phones.mobile,
                company: tenantName,
                type: "other",
                tags: ["tenant-contact"],
              },
              ctx
            );
          });

          // 5. Contacts — tenant-side brokers
          for (const agent of splitBrokers(tenantAgentRaw)) {
            upsertContact(
              {
                name: agent,
                company: tenantAgency,
                type: "broker",
                tags: ["tenant-broker"],
              },
              ctx
            );
          }

          // 6. Contacts — listing (landlord-side) brokers
          for (const agent of splitBrokers(listingAgentRaw)) {
            upsertContact(
              {
                name: agent,
                company: listingAgency,
                type: "broker",
                tags: ["listing-broker"],
              },
              ctx
            );
          }

          stats.rowsProcessed++;
        } catch (err) {
          stats.errors.push(
            `Sheet "${sheetName}" row: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }
    }

    // Compute deltas
    const afterBuildings = countOf(buildings);
    const afterTenants = countOf(tenants);
    const afterLeases = countOf(leases);
    const afterContacts = countOf(contacts);

    stats.buildingsCreated = afterBuildings - beforeBuildings;
    stats.tenantsCreated = afterTenants - beforeTenants;
    stats.leasesInserted = afterLeases - beforeLeases;
    stats.contactsCreated = afterContacts - beforeContacts;

    db.update(uploads)
      .set({
        status: "done",
        recordsCreated: stats.leasesInserted + stats.contactsCreated,
      })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

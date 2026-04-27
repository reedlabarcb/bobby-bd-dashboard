import { db } from "@/lib/db";
import { buildings, contacts, leases, tenants } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

// =========================================================================
// Pure parsing helpers
// =========================================================================

export function normAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  return String(addr)
    .trim()
    .toLowerCase()
    .replace(/[.,]+$/g, "")
    .replace(/\s+/g, " ");
}

export function splitMultiName(
  raw: string | null | undefined
): { name: string; title?: string }[] {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  const parts = str.split(/\s*;\s*|\s*\|\s*|\s+-\s+/);
  return parts
    .map((p) => {
      const m = p.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (m) return { name: m[1].trim(), title: m[2].trim() };
      return { name: p.trim() };
    })
    .filter((x) => x.name && x.name.length > 1);
}

// Comma-separated broker lists are common in Master Comps ("Roger Carlson,Larry Cambra")
// while LXD uses pipe/semicolon. Split on all three.
export function splitBrokers(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/\s*[|;,]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s !== "???" && s !== "Unknown" && s !== "NULL");
}

export type ParsedPhones = {
  primary: string | null;
  direct: string | null;
  mobile: string | null;
};

export function parsePhones(raw: string | null | undefined): ParsedPhones {
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

export function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@") && s.includes("."));
}

export function normDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NULL") return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NULL") return null;
  const n = Number(s.replace(/[,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NULL") return null;
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normPropertyClass(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^class\s+/i, "");
  return s || null;
}

export function parseSublease(raw: string | null): number {
  if (!raw) return 0;
  return /^(y|yes|true|1|sub)/i.test(String(raw).trim()) ? 1 : 0;
}

// Normalize Master Comps' rent-type vocabulary (`+E`, `NNN`, `FS`, `MG`, `G` …)
// to the canonical names used elsewhere in the app.
//   +E / +U / +J / +U+J → industrial-modified-gross variants → "Modified Gross"
//   NNN → "Triple Net"
//   FS  → "Full Service"
//   MG  → "Modified Gross"
//   G   → "Gross"
export function normLeaseType(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (s === "NNN") return "Triple Net";
  if (s === "FS") return "Full Service";
  if (s === "MG") return "Modified Gross";
  if (s === "G") return "Gross";
  if (s.startsWith("+")) return "Modified Gross";
  return raw.trim();
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// Pull the first non-empty value from a row across multiple possible column keys.
type Row = Record<string, unknown>;
export function pickStr(r: Row, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (v !== null && v !== undefined) {
      const s = String(v).trim();
      if (s !== "" && s.toUpperCase() !== "NULL") return s;
    }
  }
  return null;
}

// =========================================================================
// Upsert helpers (DB-backed, share dedup logic across importers)
// =========================================================================

export type RowContext = {
  sourceFile: string;
};

export function upsertBuilding(
  row: {
    name: string | null;
    address: string;
    city: string | null;
    propertyClass: string | null;
    propertySubtype: string | null;
    propertySizeSf: number | null;
    landlordName: string | null;
    landlordContactId: number | null;
  },
  ctx: RowContext
): number {
  const key = normAddr(row.address);
  if (!key) throw new Error("building address required");

  const match = db
    .select()
    .from(buildings)
    .all()
    .find((b) => normAddr(b.address) === key);

  if (match) {
    const patch: Partial<typeof buildings.$inferInsert> = {};
    if (!match.name && row.name) patch.name = row.name;
    if (!match.city && row.city) patch.city = row.city;
    if (!match.propertyClass && row.propertyClass) patch.propertyClass = row.propertyClass;
    if (!match.propertySubtype && row.propertySubtype) patch.propertySubtype = row.propertySubtype;
    if (!match.propertySizeSf && row.propertySizeSf) patch.propertySizeSf = row.propertySizeSf;
    if (!match.landlordName && row.landlordName) patch.landlordName = row.landlordName;
    if (!match.landlordContactId && row.landlordContactId)
      patch.landlordContactId = row.landlordContactId;
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
      propertyClass: row.propertyClass,
      propertySubtype: row.propertySubtype,
      propertySizeSf: row.propertySizeSf,
      landlordName: row.landlordName,
      landlordContactId: row.landlordContactId,
      source: ctx.sourceFile.toLowerCase().includes("master") ? "master-comps" : "prospecting-sheet",
      sourceFile: ctx.sourceFile,
    })
    .returning()
    .get();
  return inserted.id;
}

export function upsertTenantCompany(name: string, industry: string | null): number {
  const existing = db.select().from(tenants).where(eq(tenants.name, name)).get();
  if (existing) {
    if (industry && !existing.industry) {
      db.update(tenants).set({ industry }).where(eq(tenants.id, existing.id)).run();
    }
    return existing.id;
  }
  const inserted = db.insert(tenants).values({ name, industry }).returning().get();
  return inserted.id;
}

export function upsertLandlordContact(name: string, ctx: RowContext): number {
  const key = name.trim().toLowerCase();
  if (!key) throw new Error("landlord name required");
  const match = db
    .select()
    .from(contacts)
    .where(eq(contacts.type, "landlord"))
    .all()
    .find((c) => c.name.trim().toLowerCase() === key);
  if (match) return match.id;
  const inserted = db
    .insert(contacts)
    .values({
      name: name.trim(),
      type: "landlord",
      company: name.trim(),
      tags: JSON.stringify(["landlord"]),
      source: `Import: ${ctx.sourceFile}`,
      sourceFile: ctx.sourceFile,
    })
    .returning()
    .get();
  return inserted.id;
}

export type ContactInput = {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  directPhone?: string | null;
  mobilePhone?: string | null;
  company?: string | null;
  type: "buyer" | "seller" | "broker" | "lender" | "landlord" | "other";
  tags?: string[];
  notes?: string | null;
};

export function upsertContact(input: ContactInput, ctx: RowContext): number {
  let match: typeof contacts.$inferSelect | null = null;
  if (input.email) {
    match = db.select().from(contacts).where(eq(contacts.email, input.email)).get() ?? null;
  }
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
    if (!match.title && input.title) patch.title = input.title;
    if (!match.email && input.email) patch.email = input.email;
    if (!match.phone && input.phone) patch.phone = input.phone;
    if (!match.directPhone && input.directPhone) patch.directPhone = input.directPhone;
    if (!match.mobilePhone && input.mobilePhone) patch.mobilePhone = input.mobilePhone;
    if (!match.company && input.company) patch.company = input.company;
    if (!match.notes && input.notes) patch.notes = input.notes;
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
      notes: input.notes ?? null,
      source: `Import: ${ctx.sourceFile}`,
      sourceFile: ctx.sourceFile,
    })
    .returning()
    .get();
  return inserted.id;
}

export function upsertLease(
  lease: typeof leases.$inferInsert,
  key: { tenantId: number; buildingId: number; startDate: string | null }
): number {
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

// Snapshot/delta utilities — used by both importers to report stats.

export function countTable(
  table: typeof buildings | typeof tenants | typeof leases | typeof contacts
): number {
  const r = db.select({ c: sql<number>`count(*)` }).from(table).get();
  return Number(r?.c ?? 0);
}

export function countLandlords(): number {
  const r = db
    .select({ c: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.type, "landlord"))
    .get();
  return Number(r?.c ?? 0);
}

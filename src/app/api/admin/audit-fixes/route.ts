import { db } from "@/lib/db";
import {
  buildings,
  contacts,
  leases,
  tenants,
} from "@/lib/db/schema";
import { eq, isNull, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Idempotent admin endpoint that applies the cleanup actions identified by
// scripts/audit-db.mjs:
//
//  1. Merge case-insensitive duplicate tenants — keep the row whose name
//     starts with a lowercase letter (typically the Title Case version),
//     repoint leases, delete the discarded row.
//
//  2. Link buildings.landlord_contact_id to an existing landlord contact
//     when a case-insensitive name match exists.
//
//  3. Create a landlord contact for any building.landlord_name that doesn't
//     yet have one, and link it.
//
//  4. Backfill property_type='office' for leases sourced from the per-city
//     comp CSVs (those files are office-only by definition).
//
// All steps are no-ops if the DB is already clean. Safe to re-run.

export async function POST(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const headerSecret = request.headers.get("x-upload-secret");
    if (!headerSecret || headerSecret !== serverSecret) {
      return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
    }
  }

  const stats = {
    tenantsMerged: 0,
    leasesRepointed: 0,
    buildingsLinkedToExistingLandlord: 0,
    landlordContactsCreated: 0,
    buildingsLinkedToNewLandlord: 0,
    perCityLeasesPropertyTypeBackfilled: 0,
  };

  // -- 1. Merge case-insensitive duplicate tenants --
  // Title Case is preferred over ALL-CAPS, since imports tend to UPPERCASE
  // some incoming names. Pick the one whose first character is lowercase
  // somewhere (i.e. not all-caps).
  type Tenant = typeof tenants.$inferSelect;
  type DupGroup = { norm: string; rows: Tenant[] };

  const all = db.select().from(tenants).all();
  const byNorm = new Map<string, Tenant[]>();
  for (const t of all) {
    const k = t.name.trim().toLowerCase();
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k)!.push(t);
  }
  const dupGroups: DupGroup[] = [];
  for (const [norm, rows] of byNorm) {
    if (rows.length < 2) continue;
    if (new Set(rows.map((r) => r.name)).size === 1) continue; // exact same name → unrelated dup, skip
    dupGroups.push({ norm, rows });
  }

  for (const g of dupGroups) {
    // Prefer the row whose name has both upper and lower case letters (Title Case).
    const ranked = [...g.rows].sort((a, b) => {
      const aMixed = /[a-z]/.test(a.name) && /[A-Z]/.test(a.name);
      const bMixed = /[a-z]/.test(b.name) && /[A-Z]/.test(b.name);
      if (aMixed !== bMixed) return aMixed ? -1 : 1;
      // If tied, prefer the one with the longer name (more detail).
      return b.name.length - a.name.length;
    });
    const keeper = ranked[0];
    const losers = ranked.slice(1);

    for (const loser of losers) {
      const r = db
        .update(leases)
        .set({ tenantId: keeper.id })
        .where(eq(leases.tenantId, loser.id))
        .run();
      stats.leasesRepointed += r.changes;
      // Carry over industry from loser if keeper has none.
      if (!keeper.industry && loser.industry) {
        db.update(tenants).set({ industry: loser.industry }).where(eq(tenants.id, keeper.id)).run();
      }
      db.delete(tenants).where(eq(tenants.id, loser.id)).run();
      stats.tenantsMerged++;
    }
  }

  // -- 2 & 3. Link buildings to landlord contacts; create new ones if missing --
  const orphans = db
    .select()
    .from(buildings)
    .where(and(isNull(buildings.landlordContactId), sql`landlord_name IS NOT NULL`))
    .all();

  for (const b of orphans) {
    const name = b.landlordName?.trim();
    if (!name) continue;

    // 2. Try existing landlord contact (case-insensitive)
    const existing = db
      .select()
      .from(contacts)
      .where(eq(contacts.type, "landlord"))
      .all()
      .find((c) => c.name.trim().toLowerCase() === name.toLowerCase());

    if (existing) {
      db.update(buildings)
        .set({ landlordContactId: existing.id })
        .where(eq(buildings.id, b.id))
        .run();
      stats.buildingsLinkedToExistingLandlord++;
      continue;
    }

    // 3. Create a new landlord contact
    const created = db
      .insert(contacts)
      .values({
        name,
        type: "landlord",
        company: name,
        tags: JSON.stringify(["landlord"]),
        source: "audit-fix: backfill from buildings.landlord_name",
      })
      .returning()
      .get();
    db.update(buildings)
      .set({ landlordContactId: created.id })
      .where(eq(buildings.id, b.id))
      .run();
    stats.landlordContactsCreated++;
    stats.buildingsLinkedToNewLandlord++;
  }

  // -- 4. Backfill property_type='office' on per-city-CSV leases --
  const perCityFix = db.run(
    sql`UPDATE leases SET property_type = 'office' WHERE property_type IS NULL AND source_file LIKE '%Comps.csv'`
  );
  stats.perCityLeasesPropertyTypeBackfilled =
    (perCityFix as { changes?: number }).changes ?? 0;

  return NextResponse.json({ ok: true, stats });
}

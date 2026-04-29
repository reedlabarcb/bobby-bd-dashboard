import { db } from "@/lib/db";
import { tenants, contacts, buildings, leases } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// One-shot data cleanup: strip commas + parens from company-name fields and
// collapse repeated whitespace. Hunter's company resolver chokes on commas
// ("Kisco, Senior Living" → no match; "Kisco Senior Living" → match), so
// we normalize the data at rest to match. Address fields are NOT touched —
// they legitimately use commas.
//
// Targets:
//   tenants.name
//   contacts.company
//   buildings.landlord_name
//   leases.property_name
//
// Idempotent — running twice does nothing on the second pass.

function clean(value: string | null): string | null {
  if (!value) return value;
  const next = value.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  return next === value ? value : next;
}

export async function POST() {
  const stats = {
    tenantsUpdated: 0,
    contactsUpdated: 0,
    buildingsUpdated: 0,
    leasesUpdated: 0,
    examples: [] as Array<{ table: string; old: string; next: string }>,
  };

  // Tenants
  const allTenants = db.select({ id: tenants.id, name: tenants.name }).from(tenants).all();
  for (const t of allTenants) {
    const next = clean(t.name);
    if (next && next !== t.name) {
      db.update(tenants).set({ name: next }).where(sql`${tenants.id} = ${t.id}`).run();
      stats.tenantsUpdated++;
      if (stats.examples.length < 8) stats.examples.push({ table: "tenants", old: t.name, next });
    }
  }

  // Contacts.company
  const allContacts = db.select({ id: contacts.id, company: contacts.company }).from(contacts).all();
  for (const c of allContacts) {
    if (!c.company) continue;
    const next = clean(c.company);
    if (next && next !== c.company) {
      db.update(contacts).set({ company: next }).where(sql`${contacts.id} = ${c.id}`).run();
      stats.contactsUpdated++;
      if (stats.examples.length < 16)
        stats.examples.push({ table: "contacts.company", old: c.company, next });
    }
  }

  // Buildings.landlord_name
  const allBuildings = db
    .select({ id: buildings.id, landlordName: buildings.landlordName })
    .from(buildings)
    .all();
  for (const b of allBuildings) {
    if (!b.landlordName) continue;
    const next = clean(b.landlordName);
    if (next && next !== b.landlordName) {
      db.update(buildings)
        .set({ landlordName: next })
        .where(sql`${buildings.id} = ${b.id}`)
        .run();
      stats.buildingsUpdated++;
      if (stats.examples.length < 24)
        stats.examples.push({ table: "buildings.landlord_name", old: b.landlordName, next });
    }
  }

  // Leases.property_name (cosmetic, but keeps things consistent)
  const allLeases = db
    .select({ id: leases.id, propertyName: leases.propertyName })
    .from(leases)
    .all();
  for (const l of allLeases) {
    if (!l.propertyName) continue;
    const next = clean(l.propertyName);
    if (next && next !== l.propertyName) {
      db.update(leases)
        .set({ propertyName: next })
        .where(sql`${leases.id} = ${l.id}`)
        .run();
      stats.leasesUpdated++;
    }
  }

  return NextResponse.json(stats);
}

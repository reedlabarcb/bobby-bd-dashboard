import Database from "better-sqlite3";
import { deriveBuildingType } from "../src/lib/building-type";

const db = new Database("./data/bobby.db");
const buildings = db.prepare("SELECT id, name, property_subtype FROM buildings").all() as Array<{ id: number; name: string | null; property_subtype: string | null }>;
const leases = db.prepare("SELECT building_id, property_type, tenant_id FROM leases WHERE building_id IS NOT NULL").all() as Array<{ building_id: number; property_type: string | null; tenant_id: number }>;
const tenantInd = new Map<number, string | null>();
for (const t of db.prepare("SELECT id, industry FROM tenants").all() as Array<{ id: number; industry: string | null }>) {
  tenantInd.set(t.id, t.industry);
}
const lpByB = new Map<number, string[]>();
const indByB = new Map<number, string[]>();
for (const l of leases) {
  if (!lpByB.has(l.building_id)) lpByB.set(l.building_id, []);
  if (l.property_type) lpByB.get(l.building_id)!.push(l.property_type);
  if (!indByB.has(l.building_id)) indByB.set(l.building_id, []);
  const ind = tenantInd.get(l.tenant_id);
  if (ind) indByB.get(l.building_id)!.push(ind);
}
const counts: Record<string, number> = { medical: 0, office: 0, industrial: 0 };
const samples: Record<string, string[]> = { medical: [], office: [], industrial: [] };
for (const b of buildings) {
  const t = deriveBuildingType({
    propertySubtype: b.property_subtype,
    name: b.name,
    tenantIndustries: indByB.get(b.id) ?? [],
    leasePropertyTypes: lpByB.get(b.id) ?? [],
  });
  counts[t]++;
  if (samples[t].length < 5) samples[t].push(`${b.name ?? "(no name)"} | sub=${b.property_subtype ?? "—"}`);
}
console.log(`Derived building-type counts (n=${buildings.length}):`, counts);
for (const t of ["medical", "office", "industrial"]) {
  console.log(`\nSamples → ${t}:`);
  for (const s of samples[t]) console.log("  ", s);
}

export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { buildings, contacts, leases, tenants } from "@/lib/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { BuildingsMap, type BuildingPin, type BuildingTenant } from "@/components/buildings-map";

export default async function MapPage() {
  // Buildings with coordinates + landlord display name (prefer the landlord
  // contact's name, fall back to the denormalized landlord_name field).
  const rows = db
    .select({
      id: buildings.id,
      name: buildings.name,
      address: buildings.address,
      city: buildings.city,
      state: buildings.state,
      propertyClass: buildings.propertyClass,
      landlordName: buildings.landlordName,
      landlordContactName: contacts.name,
      lat: buildings.lat,
      lng: buildings.lng,
    })
    .from(buildings)
    .leftJoin(contacts, eq(buildings.landlordContactId, contacts.id))
    .where(and(isNotNull(buildings.lat), isNotNull(buildings.lng)))
    .all();

  // All leases joined to tenant — grouped by buildingId in JS.
  const leaseRows = db
    .select({
      buildingId: leases.buildingId,
      tenantName: tenants.name,
      squareFeet: leases.squareFeet,
      leaseEndDate: leases.leaseEndDate,
      monthsRemaining: leases.monthsRemaining,
    })
    .from(leases)
    .innerJoin(tenants, eq(leases.tenantId, tenants.id))
    .all();

  const leasesByBuilding = new Map<number, BuildingTenant[]>();
  for (const l of leaseRows) {
    if (l.buildingId == null) continue;
    if (!leasesByBuilding.has(l.buildingId)) leasesByBuilding.set(l.buildingId, []);
    leasesByBuilding.get(l.buildingId)!.push({
      tenantName: l.tenantName,
      squareFeet: l.squareFeet,
      leaseEndDate: l.leaseEndDate,
      monthsRemaining: l.monthsRemaining,
    });
  }

  const pins: BuildingPin[] = rows
    .filter((r): r is typeof r & { lat: number; lng: number } => r.lat != null && r.lng != null)
    .map((r) => {
      const ts = leasesByBuilding.get(r.id) ?? [];
      let soonestMonths: number | null = null;
      let soonestEndDate: string | null = null;
      let totalSf = 0;
      for (const t of ts) {
        totalSf += t.squareFeet ?? 0;
        if (t.monthsRemaining == null || t.monthsRemaining < 0) continue;
        if (soonestMonths == null || t.monthsRemaining < soonestMonths) {
          soonestMonths = t.monthsRemaining;
          soonestEndDate = t.leaseEndDate;
        }
      }
      return {
        id: r.id,
        name: r.name,
        address: r.address,
        city: r.city,
        state: r.state,
        propertyClass: r.propertyClass,
        landlord: r.landlordContactName || r.landlordName,
        lat: r.lat,
        lng: r.lng,
        tenants: ts,
        totalSf,
        soonestMonths,
        soonestEndDate,
      };
    });

  return <BuildingsMap buildings={pins} />;
}

export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { buildings, leases, tenants, contacts } from "@/lib/db/schema";
import { eq, asc, ne } from "drizzle-orm";
import { BuildingsTable } from "@/components/buildings-table";
import { deriveBuildingType } from "@/lib/building-type";

export default async function BuildingsPage() {
  // Buildings + landlord contact name (left join — building can have no FK yet).
  const allBuildings = db
    .select({
      id: buildings.id,
      name: buildings.name,
      address: buildings.address,
      city: buildings.city,
      state: buildings.state,
      submarket: buildings.submarket,
      district: buildings.district,
      propertyClass: buildings.propertyClass,
      propertySubtype: buildings.propertySubtype,
      propertySizeSf: buildings.propertySizeSf,
      landlordName: buildings.landlordName,
      landlordContactId: buildings.landlordContactId,
      landlordContactName: contacts.name,
      sourceFile: buildings.sourceFile,
    })
    .from(buildings)
    .leftJoin(contacts, eq(buildings.landlordContactId, contacts.id))
    .all();

  // All leases, joined to tenant — grouped by building in the client.
  const allLeasesRaw = db
    .select({
      id: leases.id,
      buildingId: leases.buildingId,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantIndustry: tenants.industry,
      suiteUnit: leases.suiteUnit,
      squareFeet: leases.squareFeet,
      leaseStartDate: leases.leaseStartDate,
      leaseEndDate: leases.leaseEndDate,
      monthsRemaining: leases.monthsRemaining,
      rentPsf: leases.rentPsf,
      annualRent: leases.annualRent,
      leaseType: leases.leaseType,
      isSublease: leases.isSublease,
    })
    .from(leases)
    .innerJoin(tenants, eq(leases.tenantId, tenants.id))
    .orderBy(asc(leases.leaseEndDate))
    .all();

  // Build a "first contact at this company" lookup so the tenant cell on the
  // table can deep-link to the actual person we have. Excludes landlord-typed
  // rows so the link points at a real BD-relevant contact, not an LLC entry.
  const peopleAtCompany = db
    .select({ id: contacts.id, company: contacts.company })
    .from(contacts)
    .where(ne(contacts.type, "landlord"))
    .all();
  const firstContactByCompany = new Map<string, number>();
  for (const p of peopleAtCompany) {
    if (!p.company) continue;
    const key = p.company.toLowerCase().trim();
    if (!firstContactByCompany.has(key)) firstContactByCompany.set(key, p.id);
  }

  const allLeasesWithContact = allLeasesRaw.map((l) => ({
    ...l,
    tenantContactId: l.tenantName
      ? firstContactByCompany.get(l.tenantName.toLowerCase().trim()) ?? null
      : null,
  }));

  // Derive building type (medical | office | industrial) per building from
  // property_subtype + name + tenant industries + lease.property_type.
  // Computed server-side so the client table just renders the label.
  const leasePropertyType = db
    .select({ buildingId: leases.buildingId, propertyType: leases.propertyType })
    .from(leases)
    .all();
  const leasePropertyByBuilding = new Map<number, string[]>();
  for (const l of leasePropertyType) {
    if (l.buildingId == null) continue;
    if (!leasePropertyByBuilding.has(l.buildingId)) leasePropertyByBuilding.set(l.buildingId, []);
    if (l.propertyType) leasePropertyByBuilding.get(l.buildingId)!.push(l.propertyType);
  }
  const tenantIndustriesByBuilding = new Map<number, string[]>();
  for (const l of allLeasesRaw) {
    if (l.buildingId == null) continue;
    if (!tenantIndustriesByBuilding.has(l.buildingId)) tenantIndustriesByBuilding.set(l.buildingId, []);
    if (l.tenantIndustry) tenantIndustriesByBuilding.get(l.buildingId)!.push(l.tenantIndustry);
  }
  const buildingsWithType = allBuildings.map((b) => ({
    ...b,
    buildingType: deriveBuildingType({
      propertySubtype: b.propertySubtype,
      name: b.name,
      tenantIndustries: tenantIndustriesByBuilding.get(b.id) ?? [],
      leasePropertyTypes: leasePropertyByBuilding.get(b.id) ?? [],
    }),
  }));

  return <BuildingsTable buildings={buildingsWithType} leases={allLeasesWithContact} />;
}

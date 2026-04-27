export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { buildings, leases, tenants, contacts } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { BuildingsTable } from "@/components/buildings-table";

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
  const allLeases = db
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

  return <BuildingsTable buildings={allBuildings} leases={allLeases} />;
}

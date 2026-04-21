import { db } from "@/lib/db";
import { leases, tenants } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { LeasesTable } from "@/components/leases-table";

export default async function LeasesPage() {
  const allLeases = db
    .select({
      id: leases.id,
      tenantName: tenants.name,
      tenantIndustry: tenants.industry,
      tenantCreditRating: tenants.creditRating,
      tenantId: tenants.id,
      propertyName: leases.propertyName,
      propertyAddress: leases.propertyAddress,
      propertyCity: leases.propertyCity,
      propertyState: leases.propertyState,
      propertyType: leases.propertyType,
      suiteUnit: leases.suiteUnit,
      squareFeet: leases.squareFeet,
      leaseStartDate: leases.leaseStartDate,
      leaseEndDate: leases.leaseEndDate,
      monthsRemaining: leases.monthsRemaining,
      rentPsf: leases.rentPsf,
      annualRent: leases.annualRent,
      leaseType: leases.leaseType,
      options: leases.options,
      escalations: leases.escalations,
      sourceFile: leases.sourceFile,
      confidence: leases.confidence,
      documentId: leases.documentId,
      dealId: leases.dealId,
    })
    .from(leases)
    .innerJoin(tenants, eq(leases.tenantId, tenants.id))
    .orderBy(asc(leases.leaseEndDate))
    .all();

  return <LeasesTable leases={allLeases} />;
}

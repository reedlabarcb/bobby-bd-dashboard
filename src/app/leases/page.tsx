export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { buildings, contacts, leases, tenants } from "@/lib/db/schema";
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
      buildingId: leases.buildingId,
      landlordContactId: buildings.landlordContactId,
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
    .leftJoin(buildings, eq(leases.buildingId, buildings.id))
    .orderBy(asc(leases.leaseEndDate))
    .all();

  // Index tenant-side contacts by canonical company key (case-insensitive,
  // trimmed). Grouping in JS so we hit the DB once instead of per-lease.
  const allContacts = db
    .select({
      id: contacts.id,
      name: contacts.name,
      title: contacts.title,
      email: contacts.email,
      phone: contacts.phone,
      directPhone: contacts.directPhone,
      mobilePhone: contacts.mobilePhone,
      company: contacts.company,
      type: contacts.type,
      tags: contacts.tags,
    })
    .from(contacts)
    .all();

  const contactsByCompanyKey = new Map<string, typeof allContacts>();
  const contactById = new Map<number, (typeof allContacts)[number]>();
  for (const c of allContacts) {
    contactById.set(c.id, c);
    if (c.company && c.type !== "landlord") {
      const key = c.company.trim().toLowerCase();
      if (!contactsByCompanyKey.has(key)) contactsByCompanyKey.set(key, []);
      contactsByCompanyKey.get(key)!.push(c);
    }
  }

  const enriched = allLeases.map((l) => {
    const tenantKey = l.tenantName.trim().toLowerCase();
    const tenantContacts = (contactsByCompanyKey.get(tenantKey) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone || c.directPhone || c.mobilePhone,
      type: c.type,
    }));
    const landlordContact = l.landlordContactId
      ? (() => {
          const c = contactById.get(l.landlordContactId);
          return c ? { id: c.id, name: c.name } : null;
        })()
      : null;
    return { ...l, tenantContacts, landlordContact };
  });

  return <LeasesTable leases={enriched} />;
}

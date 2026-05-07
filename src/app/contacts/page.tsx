export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { contacts, tenants, buildings, leases } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { Building2, List } from "lucide-react";
import { ContactsTable, type ContactWithLease } from "@/components/contacts-table";
import { ContactsByCompany } from "@/components/contacts-by-company";
import { Button } from "@/components/ui/button";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  // Default view is company — companies as the primary index, click a
  // company name to expand into the people there. Use ?view=flat to
  // get the people-first table.
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "company";
  const isFlat = view === "flat";

  // People-only: exclude landlord-typed rows and rows whose `name` is clearly
  // a company entity (LLC / LP / Inc / Trust / Holdings / etc.). These show
  // up because the prospecting-sheet importer sometimes lands company-form
  // landlords in the contacts table; the /contacts tab is for actual humans.
  const COMPANY_ENTITY_RE =
    /\b(LLC|L\.L\.C\.?|LP|L\.P\.?|LLP|L\.L\.P\.?|Inc\.?|Incorporated|Corp\.?|Corporation|Trust|Holdings?|Investments?|Realty|Capital|Partners|Properties|Property|Group|Ltd\.?|Co\.?|Company|Associates|Enterprises|Ventures|Realty)\b/i;

  const allContacts = db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt))
    .all()
    .filter((c) => c.type !== "landlord" && !COMPANY_ENTITY_RE.test(c.name));

  // Pull every lease joined to its tenant so we can pin the soonest-expiring
  // lease onto each contact via company-name match.
  const allLeases = db
    .select({
      tenantName: tenants.name,
      leaseEndDate: leases.leaseEndDate,
      squareFeet: leases.squareFeet,
      monthsRemaining: leases.monthsRemaining,
      propertyName: leases.propertyName,
      propertyAddress: leases.propertyAddress,
    })
    .from(leases)
    .innerJoin(tenants, eq(leases.tenantId, tenants.id))
    .all();

  type LeaseHit = (typeof allLeases)[number];
  const leaseByCompany = new Map<string, LeaseHit>();
  for (const l of allLeases) {
    if (!l.tenantName) continue;
    const key = l.tenantName.toLowerCase().trim();
    const existing = leaseByCompany.get(key);
    if (!existing) {
      leaseByCompany.set(key, l);
      continue;
    }
    // Prefer soonest *future* expiration (months >= 0); fall back to most
    // recent past expiration so we still surface something.
    const a = l.monthsRemaining ?? 9999;
    const b = existing.monthsRemaining ?? 9999;
    const aFuture = a >= 0;
    const bFuture = b >= 0;
    if (aFuture && !bFuture) leaseByCompany.set(key, l);
    else if (aFuture === bFuture && a < b) leaseByCompany.set(key, l);
  }

  const enrichedContacts: ContactWithLease[] = allContacts.map((c) => {
    const key = c.company?.toLowerCase().trim();
    const lease = key ? leaseByCompany.get(key) : undefined;
    return {
      ...c,
      leaseEndDate: lease?.leaseEndDate ?? null,
      squareFeet: lease?.squareFeet ?? null,
      monthsRemaining: lease?.monthsRemaining ?? null,
      propertyName: lease?.propertyName ?? null,
      propertyAddress: lease?.propertyAddress ?? null,
    };
  });

  // Surface companies referenced elsewhere so they appear as groups even
  // when no people are tracked there yet — that way Bobby can click a
  // tenant on /leases and land on a "+ Add Person" prompt for that
  // company instead of an empty page.
  const tenantNames = db
    .select({ name: tenants.name, industry: tenants.industry })
    .from(tenants)
    .all();
  const buildingLandlords = db
    .select({ name: buildings.landlordName })
    .from(buildings)
    .all();

  const seedCompanies: { name: string; industry?: string | null; source: "tenant" | "landlord" }[] = [];
  for (const t of tenantNames) {
    if (t.name && t.name.trim()) {
      seedCompanies.push({ name: t.name.trim(), industry: t.industry, source: "tenant" });
    }
  }
  for (const b of buildingLandlords) {
    if (b.name && b.name.trim()) {
      seedCompanies.push({ name: b.name.trim(), source: "landlord" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Every person — with their company, lease expiration, and square feet pulled in.
          </p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
          <Link href="/contacts?view=flat">
            <Button
              variant={isFlat ? "default" : "ghost"}
              size="sm"
              className="gap-1.5"
            >
              <List className="size-3.5" />
              People
            </Button>
          </Link>
          <Link href="/contacts?view=company">
            <Button
              variant={isFlat ? "ghost" : "default"}
              size="sm"
              className="gap-1.5"
            >
              <Building2 className="size-3.5" />
              By Company
            </Button>
          </Link>
        </div>
      </div>

      {isFlat ? (
        <ContactsTable contacts={enrichedContacts} autoOpenAdd={sp.add === "true"} />
      ) : (
        <ContactsByCompany contacts={allContacts} seedCompanies={seedCompanies} />
      )}
    </div>
  );
}

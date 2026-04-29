import { db } from "@/lib/db";
import { contacts, tenants } from "@/lib/db/schema";
import { ne, sql } from "drizzle-orm";
import { BulkEnrichTenants } from "@/components/bulk-enrich-tenants";
import { BulkEnrichContacts } from "@/components/bulk-enrich-contacts";
import { DiagnosticsCard } from "@/components/diagnostics-card";
import { ProbeCompanyCard } from "@/components/probe-company-card";

export const dynamic = "force-dynamic";

type TenantNeedingContacts = {
  id: number;
  name: string;
  industry: string | null;
  existingContacts: number;
};

function loadTenantsNeedingContacts(): TenantNeedingContacts[] {
  // Tenants where no contact row matches the tenant.name on contacts.company.
  // Case- and whitespace-insensitive match keeps "TS Restaurants" === " ts restaurants ".
  const rows = db
    .select({
      id: tenants.id,
      name: tenants.name,
      industry: tenants.industry,
      existingContacts: sql<number>`(
        SELECT COUNT(*) FROM ${contacts}
        WHERE lower(trim(${contacts.company})) = lower(trim(${tenants.name}))
      )`.as("existing_contacts"),
    })
    .from(tenants)
    .all();

  return rows
    .filter((r) => r.existingContacts === 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadEnrichableContacts() {
  // Exclude landlords per Bob — those are LLC entities, Apollo can't enrich them.
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      company: contacts.company,
      type: contacts.type,
    })
    .from(contacts)
    .where(ne(contacts.type, "landlord"))
    .orderBy(contacts.name)
    .all();
}

export default async function EnrichPage() {
  const tenantsNeeding = loadTenantsNeedingContacts();
  const enrichableContacts = loadEnrichableContacts();
  const totalTenants = db.select({ count: sql<number>`count(*)` }).from(tenants).get()?.count || 0;
  const totalContacts = db.select({ count: sql<number>`count(*)` }).from(contacts).get()?.count || 0;
  const missingEmail = enrichableContacts.filter((c) => !c.email).length;

  return (
    <div className="container max-w-5xl mx-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Bulk Enrichment</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fill in missing emails/phones on existing contacts, or find new decision-makers at tenant companies.
        </p>
      </div>

      <DiagnosticsCard />

      <ProbeCompanyCard />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total Tenants</div>
          <div className="text-2xl font-semibold mt-1">{totalTenants}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total Contacts</div>
          <div className="text-2xl font-semibold mt-1">{totalContacts}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Missing Email</div>
          <div className="text-2xl font-semibold mt-1 text-amber-500">{missingEmail}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Tenants Without Contacts</div>
          <div className="text-2xl font-semibold mt-1 text-amber-500">{tenantsNeeding.length}</div>
        </div>
      </div>

      {/* Primary: enrich existing contacts (Bob's main ask) */}
      <div className="rounded-lg border border-border bg-card p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Enrich existing contacts</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Apollo + Hunter fill in missing email, phone, title, LinkedIn, and direct/mobile numbers for the contacts already in your database. Landlords are excluded.
          </p>
        </div>
        <BulkEnrichContacts contacts={enrichableContacts} />
      </div>

      {/* Secondary: find decision-makers at tenants without any contact */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Find decision-makers at tenants without contacts</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Apollo searches each company for these titles: CEO, President, CFO, COO, VP/Head/Director of Real Estate, VP Operations.
            Up to 3 contacts created per tenant. Hunter fills in any emails Apollo misses.
          </p>
        </div>
        <BulkEnrichTenants tenants={tenantsNeeding} />
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Building2, List } from "lucide-react";
import { ContactsTable } from "@/components/contacts-table";
import { ContactsByCompany } from "@/components/contacts-by-company";
import { Button } from "@/components/ui/button";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "company";
  const isFlat = view === "flat";

  const allContacts = db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt))
    .all();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Company / Name</h1>
          <p className="text-sm text-muted-foreground">
            Companies grouped with their personal contacts. Click a company to expand,
            add people inline, or click a person to edit.
          </p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
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
          <Link href="/contacts?view=flat">
            <Button
              variant={isFlat ? "default" : "ghost"}
              size="sm"
              className="gap-1.5"
            >
              <List className="size-3.5" />
              Flat List
            </Button>
          </Link>
        </div>
      </div>

      {isFlat ? (
        <ContactsTable contacts={allContacts} autoOpenAdd={sp.add === "true"} />
      ) : (
        <ContactsByCompany contacts={allContacts} />
      )}
    </div>
  );
}

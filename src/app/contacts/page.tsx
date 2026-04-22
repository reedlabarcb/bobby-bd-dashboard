export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { ContactsTable } from "@/components/contacts-table";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { add } = await searchParams;
  const allContacts = db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt))
    .all();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          Manage your contacts and track relationships.
        </p>
      </div>
      <ContactsTable contacts={allContacts} autoOpenAdd={add === "true"} />
    </div>
  );
}

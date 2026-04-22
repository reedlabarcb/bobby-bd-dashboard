export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { documents, leases, tenants } from "@/lib/db/schema";
import { desc, count } from "drizzle-orm";
import { DocumentLibrary } from "@/components/document-library";

export default async function LibraryPage() {
  const allDocs = db.select().from(documents).orderBy(desc(documents.createdAt)).all();

  const totalDocs = allDocs.length;
  const processedDocs = allDocs.filter((d) => d.status === "done").length;
  const totalLeases = db.select({ count: count() }).from(leases).get()?.count || 0;
  const totalTenants = db.select({ count: count() }).from(tenants).get()?.count || 0;

  return (
    <DocumentLibrary
      documents={allDocs}
      stats={{
        totalDocs,
        processedDocs,
        totalLeases,
        totalTenants,
      }}
    />
  );
}

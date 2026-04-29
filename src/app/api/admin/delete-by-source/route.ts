import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";

// Delete contacts whose sourceFile matches an exact value or a LIKE pattern.
// Used to undo a bad import. Returns the count that would be / was deleted.
//
// POST { sourceFile: string, pattern?: boolean, dryRun?: boolean }
export async function POST(request: Request) {
  const { sourceFile, pattern, dryRun } = await request.json();
  if (!sourceFile || typeof sourceFile !== "string") {
    return NextResponse.json({ error: "sourceFile required" }, { status: 400 });
  }

  const where = pattern
    ? like(contacts.sourceFile, sourceFile)
    : eq(contacts.sourceFile, sourceFile);

  const matching = db
    .select({ id: contacts.id, name: contacts.name, company: contacts.company })
    .from(contacts)
    .where(where)
    .all();

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      count: matching.length,
      preview: matching.slice(0, 10),
    });
  }

  const deleted = db.delete(contacts).where(where).returning({ id: contacts.id }).all();
  return NextResponse.json({
    deletedCount: deleted.length,
    preview: matching.slice(0, 10),
  });
}

import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { and, isNull, like, or, eq, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

// Delete contacts matching a flexible filter. Used to undo a bad import.
//
// POST {
//   sourceFile?: string,           // exact OR LIKE if pattern=true
//   source?: string,               // exact OR LIKE if pattern=true
//   pattern?: boolean,             // treat strings above as LIKE patterns
//   emailIsNull?: boolean,         // require email IS NULL
//   phoneIsNull?: boolean,         // require phone IS NULL
//   companyIsNull?: boolean,       // require company IS NULL
//   dryRun?: boolean,
// }
export async function POST(request: Request) {
  const body = await request.json();
  const { sourceFile, source, pattern, emailIsNull, phoneIsNull, companyIsNull, dryRun } = body;

  if (!sourceFile && !source) {
    return NextResponse.json({ error: "sourceFile or source required" }, { status: 400 });
  }

  const conditions: SQL[] = [];
  if (sourceFile) {
    conditions.push(
      pattern ? like(contacts.sourceFile, sourceFile) : eq(contacts.sourceFile, sourceFile),
    );
  }
  if (source) {
    conditions.push(pattern ? like(contacts.source, source) : eq(contacts.source, source));
  }
  if (emailIsNull) conditions.push(isNull(contacts.email));
  if (phoneIsNull) conditions.push(isNull(contacts.phone));
  if (companyIsNull) conditions.push(isNull(contacts.company));

  const where =
    conditions.length === 1
      ? conditions[0]
      : (conditions.length > 1 ? and(...conditions) : undefined);
  if (!where) {
    return NextResponse.json({ error: "no filters resolved" }, { status: 400 });
  }
  // Defensive: never allow a delete without at least one source/sourceFile filter.
  void or; // silence unused warning if drizzle-kit changes its export shape

  const matching = db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(where)
    .all();

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      count: matching.length,
      preview: matching.slice(0, 15),
    });
  }

  const deleted = db.delete(contacts).where(where).returning({ id: contacts.id }).all();
  return NextResponse.json({
    deletedCount: deleted.length,
    preview: matching.slice(0, 15),
  });
}

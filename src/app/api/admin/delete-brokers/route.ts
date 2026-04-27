import { db } from "@/lib/db";
import { activities, contacts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Idempotent admin endpoint to remove every contact with type='broker'.
//
// Bobby doesn't want competing-brokerage agents (CBRE/C&W/JLL/Hughes Marino
// etc) showing up as prospects. Imports tag them all type='broker', so this
// is the cleanup hook to run after each ingest.
//
// FK handling: activities.contact_id and buildings.landlord_contact_id can
// reference contacts.id. We NULL those out first to avoid the FOREIGN KEY
// constraint failing on delete. (Landlord contacts have type='landlord', so
// in practice no buildings reference broker rows — but we NULL them anyway
// for safety.)

export async function DELETE(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const headerSecret = request.headers.get("x-upload-secret");
    if (!headerSecret || headerSecret !== serverSecret) {
      return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
    }
  }

  const beforeCount = Number(
    db
      .select({ c: sql<number>`count(*)` })
      .from(contacts)
      .where(eq(contacts.type, "broker"))
      .get()?.c ?? 0
  );

  if (beforeCount === 0) {
    return NextResponse.json({ ok: true, deleted: 0, fkNulled: 0 });
  }

  // 1. NULL FK references in activities
  const activitiesNulled = db
    .update(activities)
    .set({ contactId: null })
    .where(
      sql`${activities.contactId} IN (SELECT id FROM contacts WHERE type = 'broker')`
    )
    .run();

  // 2. NULL FK references in buildings.landlord_contact_id (defensive — should be 0)
  const buildingsNulled = db.run(
    sql`UPDATE buildings SET landlord_contact_id = NULL WHERE landlord_contact_id IN (SELECT id FROM contacts WHERE type = 'broker')`
  );

  // 3. Delete the brokers
  const del = db.delete(contacts).where(eq(contacts.type, "broker")).run();

  return NextResponse.json({
    ok: true,
    deleted: del.changes,
    activitiesNulled: activitiesNulled.changes,
    buildingsNulled: (buildingsNulled as { changes?: number }).changes ?? 0,
    beforeCount,
  });
}

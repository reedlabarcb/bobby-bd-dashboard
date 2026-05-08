import { db } from "@/lib/db";
import { activities, buildings, contactEnrichments, contacts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerReason } from "@/lib/constants/broker-filter";

/**
 * Admin endpoint — remove every contact that matches the broker filter
 * (title keywords / company keywords / type=broker / brokerage-shaped name).
 *
 * Body: {confirm: "DELETE-ALL-BROKERS"} — required for non-dry-run.
 * Header: x-upload-secret: <UPLOAD_SECRET>
 *
 * Mirrors `scripts/remove-brokers.ts` so it can be run against Railway
 * production without shell access.
 */

export async function DELETE(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const headerSecret = request.headers.get("x-upload-secret");
    if (!headerSecret || headerSecret !== serverSecret) {
      return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
    }
  }

  let body: { confirm?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body = dry-run */
  }
  const confirmed = body.confirm === "DELETE-ALL-BROKERS";

  const all = db.select({
    id: contacts.id, name: contacts.name, title: contacts.title,
    company: contacts.company, type: contacts.type,
  }).from(contacts).all();

  const toDelete: { id: number; name: string; reason: string }[] = [];
  for (const c of all) {
    const reason = brokerReason({ name: c.name, title: c.title, company: c.company, type: c.type });
    if (reason) toDelete.push({ id: c.id, name: c.name, reason });
  }

  if (!confirmed) {
    return NextResponse.json({
      dryRun: true,
      total: all.length,
      wouldDelete: toDelete.length,
      sample: toDelete.slice(0, 25),
      hint: 'send {"confirm":"DELETE-ALL-BROKERS"} in the body to actually run',
    });
  }

  if (toDelete.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, total: all.length });
  }

  const ids = toDelete.map((x) => x.id);
  let activitiesNulled = 0;
  let enrichmentsDeleted = 0;
  let buildingsNulled = 0;
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    activitiesNulled += db.update(activities).set({ contactId: null }).where(inArray(activities.contactId, chunk)).run().changes;
    enrichmentsDeleted += db.delete(contactEnrichments).where(inArray(contactEnrichments.contactId, chunk)).run().changes;
    buildingsNulled += db.update(buildings).set({ landlordContactId: null }).where(inArray(buildings.landlordContactId, chunk)).run().changes;
  }

  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    deleted += db.delete(contacts).where(inArray(contacts.id, chunk)).run().changes;
  }

  // Sanity: any still match?
  const remaining = db.select({
    id: contacts.id, name: contacts.name, title: contacts.title, company: contacts.company, type: contacts.type,
  }).from(contacts).all();
  const stillDirty = remaining.filter((c) => brokerReason({ name: c.name, title: c.title, company: c.company, type: c.type })).length;

  return NextResponse.json({
    ok: true,
    before: all.length,
    deleted,
    activitiesNulled,
    enrichmentsDeleted,
    buildingsNulled,
    after: remaining.length,
    stillMatchingFilter: stillDirty,
  });
}

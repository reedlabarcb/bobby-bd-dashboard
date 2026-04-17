import { db } from "@/lib/db";
import { activities, contacts, deals } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const all = db.select({
    id: activities.id,
    type: activities.type,
    subject: activities.subject,
    body: activities.body,
    date: activities.date,
    contactId: activities.contactId,
    dealId: activities.dealId,
    contactName: contacts.name,
    dealName: deals.name,
    createdAt: activities.createdAt,
  })
    .from(activities)
    .leftJoin(contacts, eq(activities.contactId, contacts.id))
    .leftJoin(deals, eq(activities.dealId, deals.id))
    .orderBy(desc(activities.date))
    .limit(200)
    .all();

  return NextResponse.json(all);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = db.insert(activities).values({
      contactId: body.contactId || null,
      dealId: body.dealId || null,
      type: body.type,
      subject: body.subject || null,
      body: body.body || null,
      date: body.date || new Date().toISOString().replace("T", " ").split(".")[0],
    }).returning().get();

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create activity" },
      { status: 500 }
    );
  }
}

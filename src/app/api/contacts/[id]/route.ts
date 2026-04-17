import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contact = db.select().from(contacts).where(eq(contacts.id, parseInt(id))).get();
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(contact);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const result = db.update(contacts)
      .set({
        ...body,
        tags: body.tags ? JSON.stringify(body.tags) : undefined,
        updatedAt: new Date().toISOString().replace("T", " ").split(".")[0],
      })
      .where(eq(contacts.id, parseInt(id)))
      .returning()
      .get();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update contact" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.delete(contacts).where(eq(contacts.id, parseInt(id))).run();
  return NextResponse.json({ success: true });
}

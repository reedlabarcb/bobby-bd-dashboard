import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { NextResponse } from "next/server";

export async function GET() {
  const all = db.select().from(contacts).all();
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = db.insert(contacts).values({
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      company: body.company || null,
      title: body.title || null,
      type: body.type || "other",
      source: body.source || null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      city: body.city || null,
      state: body.state || null,
      notes: body.notes || null,
    }).returning().get();

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create contact" },
      { status: 500 }
    );
  }
}

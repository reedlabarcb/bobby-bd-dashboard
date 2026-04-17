import { db } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { NextResponse } from "next/server";

export async function GET() {
  const all = db.select().from(deals).all();
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = db.insert(deals).values({
      name: body.name,
      propertyType: body.propertyType || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      askingPrice: body.askingPrice || null,
      status: body.status || "prospect",
      sourceFile: body.sourceFile || null,
      aiSummary: body.aiSummary || null,
      rawText: body.rawText || null,
      lat: body.lat || null,
      lng: body.lng || null,
    }).returning().get();

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create deal" },
      { status: 500 }
    );
  }
}

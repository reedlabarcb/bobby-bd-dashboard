import { db } from "@/lib/db";
import { deals, uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseOfferingMemorandum } from "@/lib/api/anthropic";
import { NextResponse } from "next/server";

async function geocodeAddress(address: string, city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = encodeURIComponent(`${address}, ${city}, ${state}`);
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${query}&benchmark=Public_AR_Current&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      const match = data.result?.addressMatches?.[0];
      if (match) {
        return { lat: match.coordinates.y, lng: match.coordinates.x };
      }
    }
  } catch {
    // Geocoding is best-effort
  }
  return null;
}

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Create upload record
    const upload = db.insert(uploads).values({
      filename: file.name,
      fileType: "pdf",
      status: "processing",
    }).returning().get();

    // Convert to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Parse with Claude
    const parsed = await parseOfferingMemorandum(base64);

    // Geocode the address
    const coords = await geocodeAddress(parsed.address, parsed.city, parsed.state);

    // Save deal
    const deal = db.insert(deals).values({
      name: parsed.name,
      propertyType: parsed.propertyType,
      address: parsed.address,
      city: parsed.city,
      state: parsed.state,
      askingPrice: parsed.askingPrice,
      status: "prospect",
      sourceFile: file.name,
      aiSummary: parsed.summary,
      rawText: JSON.stringify({ highlights: parsed.highlights, brokerInfo: parsed.brokerInfo }),
      lat: coords?.lat || null,
      lng: coords?.lng || null,
    }).returning().get();

    // Update upload record
    db.update(uploads)
      .set({ status: "done", recordsCreated: 1 })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({ deal, parsed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse OM" },
      { status: 500 }
    );
  }
}

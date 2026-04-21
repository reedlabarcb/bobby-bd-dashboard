import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processDocument } from "@/lib/api/document-processor";
import { NextResponse } from "next/server";

// Upload and process a document directly (without Box)
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

    const fileType = file.name.split(".").pop()?.toLowerCase() || "unknown";
    if (fileType !== "pdf") {
      return NextResponse.json({ error: "Only PDF files are currently supported" }, { status: 400 });
    }

    // Create document record
    const doc = db.insert(documents).values({
      filename: file.name,
      fileType,
      fileSize: file.size,
      status: "pending",
    }).returning().get();

    // Process
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    await processDocument(doc.id, base64);

    // Fetch updated doc
    const updated = db.select().from(documents).where(
      eq(documents.id, doc.id)
    ).get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}

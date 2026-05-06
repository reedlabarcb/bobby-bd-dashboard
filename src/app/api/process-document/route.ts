import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processDocument } from "@/lib/api/document-processor";
import { NextResponse } from "next/server";

// Upload and process a document directly (without Box).
// Accepts multipart form-data uploads from the web UI or the Box watcher.
export async function POST(request: Request) {
  try {
    // Optional shared-secret auth for non-browser uploaders (the Box watcher).
    // When UPLOAD_SECRET is set, any request carrying X-Upload-Secret must match.
    // Browser uploads (without the header) are still allowed so the Library UI works.
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const headerSecret = request.headers.get("x-upload-secret");
      if (headerSecret && headerSecret !== serverSecret) {
        return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
    }

    // Two upload paths:
    //   - multipart/form-data (browser uploads, Box watcher) → Next parses FormData
    //   - application/json {filename, base64, fileSize?} (batch script for >10MB PDFs
    //     that hit Next's multipart parser limits)
    let filename: string;
    let base64: string;
    let fileSize: number;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as { filename?: string; base64?: string; fileSize?: number };
      if (!body.filename || !body.base64) {
        return NextResponse.json({ error: "Missing filename or base64" }, { status: 400 });
      }
      filename = body.filename;
      base64 = body.base64;
      fileSize = body.fileSize ?? Math.floor((body.base64.length * 3) / 4);
    } else {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      filename = file.name;
      fileSize = file.size;
      const buffer = await file.arrayBuffer();
      base64 = Buffer.from(buffer).toString("base64");
    }

    const fileType = filename.split(".").pop()?.toLowerCase() || "unknown";
    if (fileType !== "pdf") {
      return NextResponse.json({ error: "Only PDF files are currently supported" }, { status: 400 });
    }

    // Reuse existing error/pending record for the same filename if present
    const existing = db.select().from(documents)
      .where(eq(documents.filename, filename))
      .get();

    let doc: typeof existing;
    if (existing && existing.status !== "done") {
      db.update(documents)
        .set({ status: "pending", errorMessage: null, fileSize })
        .where(eq(documents.id, existing.id))
        .run();
      doc = { ...existing, status: "pending" };
    } else if (!existing) {
      doc = db.insert(documents).values({
        filename,
        fileType,
        fileSize,
        status: "pending",
      }).returning().get();
    } else {
      // already done — still reprocess (explicit reprocess action)
      db.update(documents)
        .set({ status: "pending", errorMessage: null })
        .where(eq(documents.id, existing.id))
        .run();
      doc = { ...existing, status: "pending" };
    }

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

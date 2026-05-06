import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processDocument, type DocumentSource } from "@/lib/api/document-processor";
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
    //   - multipart/form-data (browser, Box watcher) for files ≤10MB
    //   - application/json {filename, fileId, fileSize?} for files >10MB.
    //     The script uploads the PDF to Anthropic Files API directly and
    //     passes only the file_id through Railway, bypassing Next's body
    //     parser limits entirely.
    let filename: string;
    let fileSize: number;
    let source: DocumentSource;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as { filename?: string; fileId?: string; fileSize?: number };
      if (!body.filename || !body.fileId) {
        return NextResponse.json({ error: "Missing filename or fileId" }, { status: 400 });
      }
      filename = body.filename;
      fileSize = body.fileSize ?? 0;
      source = { kind: "fileId", fileId: body.fileId };
    } else {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      filename = file.name;
      fileSize = file.size;
      const buffer = await file.arrayBuffer();
      source = { kind: "base64", data: Buffer.from(buffer).toString("base64") };
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

    await processDocument(doc.id, source);

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

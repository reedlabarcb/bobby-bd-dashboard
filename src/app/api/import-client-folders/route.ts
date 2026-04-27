import { db } from "@/lib/db";
import { deals, documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

// Mirror endpoint of scripts/import-client-folders.ts — accepts the same
// manifest JSON the local script reads from disk, so we can populate
// Railway prod without copying the local SQLite file up.
//
// Body: { generatedAt, zipPath, deals: [{year, client, files: [{path, ext, size, lastWrite}]}] }
//
// Idempotent: re-running won't create duplicates (deal dedup by sourceFile,
// document dedup by (dealId, filename)).

type ManifestFile = {
  path: string;
  ext: string;
  size: number;
  lastWrite?: string;
};

type ManifestDeal = {
  year: number;
  client: string;
  files: ManifestFile[];
};

type ManifestPayload = {
  generatedAt?: string;
  zipPath?: string;
  deals: ManifestDeal[];
};

const SKIP_EXTS = new Set([".indd", ".otf", ".lst", ".zip"]);

function fileTypeOf(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "pdf";
    case ".docx":
    case ".doc":
      return "docx";
    case ".xlsx":
    case ".xls":
    case ".csv":
      return "xlsx";
    case ".pptx":
    case ".ppt":
      return "pptx";
    case ".msg":
    case ".eml":
      return "email";
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".webp":
      return "image";
    default:
      return ext.replace(".", "") || "other";
  }
}

function statusForYear(year: number): "prospect" | "active" | "closed" {
  if (year >= 2026) return "active";
  return "closed";
}

export async function POST(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const headerSecret = request.headers.get("x-upload-secret");
    if (!headerSecret || headerSecret !== serverSecret) {
      return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
    }
  }

  let payload: ManifestPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload || !Array.isArray(payload.deals)) {
    return NextResponse.json({ error: "Body must include `deals: []`" }, { status: 400 });
  }

  const stats = {
    dealsCreated: 0,
    dealsExisting: 0,
    documentsCreated: 0,
    documentsExisting: 0,
    filesSkipped: 0,
  };

  for (const md of payload.deals) {
    if (!md || !md.client || typeof md.year !== "number" || !Array.isArray(md.files)) {
      continue;
    }
    const sourceFile = `Bob.zip:${md.year}/${md.client}`;
    const folderPath = `Bob.zip:Bob/${md.year}/${md.client}`;

    let dealId: number;
    const existing = db
      .select()
      .from(deals)
      .where(eq(deals.sourceFile, sourceFile))
      .get();

    if (existing) {
      dealId = existing.id;
      stats.dealsExisting++;
    } else {
      const inserted = db
        .insert(deals)
        .values({
          name: `${md.client} (${md.year})`,
          status: statusForYear(md.year),
          sourceFile,
          aiSummary: `Imported from ${payload.zipPath ?? "Bob.zip"} — ${md.files.length} document${
            md.files.length === 1 ? "" : "s"
          } in ${md.year}/${md.client}.`,
        })
        .returning()
        .get();
      dealId = inserted.id;
      stats.dealsCreated++;
    }

    for (const f of md.files) {
      if (SKIP_EXTS.has(f.ext)) {
        stats.filesSkipped++;
        continue;
      }
      const filename = f.path;
      const fileType = fileTypeOf(f.ext);

      const existingDoc = db
        .select()
        .from(documents)
        .where(and(eq(documents.dealId, dealId), eq(documents.filename, filename)))
        .get();

      if (existingDoc) {
        stats.documentsExisting++;
        continue;
      }

      db.insert(documents)
        .values({
          filename,
          fileType,
          boxFolderPath: folderPath,
          fileSize: f.size,
          boxModifiedAt: f.lastWrite ?? null,
          status: "pending",
          dealId,
        })
        .run();
      stats.documentsCreated++;
    }
  }

  return NextResponse.json({ ok: true, stats });
}

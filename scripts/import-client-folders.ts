// Reads data/_bob-manifest.json (produced by extract-bob-manifest.ps1) and
// upserts a `deals` row per client folder + a `documents` row per file.
//
// Idempotent: re-running won't create duplicates. Safe to run after refreshing
// the manifest.
//
// Run: npx tsx scripts/import-client-folders.ts [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { deals, documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

type ManifestFile = {
  path: string; // path inside the client folder
  fullPath: string; // full path inside the zip
  ext: string; // ".pdf", ".docx", etc.
  size: number;
  lastWrite: string;
};

type ManifestDeal = {
  year: number;
  client: string;
  files: ManifestFile[];
};

type Manifest = {
  generatedAt: string;
  zipPath: string;
  deals: ManifestDeal[];
};

// Skip purely-design assets and packaging cruft. Include everything else.
const SKIP_EXTS = new Set([".indd", ".otf", ".lst", ".zip"]);

// Map file extension → file_type label that the existing /library UI groups by.
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
  if (year === 2025) return "closed"; // assume completed; user can change
  return "closed";
}

const dryRun = process.argv.includes("--dry-run");

const manifestPath = path.resolve(process.cwd(), "data/_bob-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(
    `Manifest not found at ${manifestPath}. Run scripts/extract-bob-manifest.ps1 first.`
  );
  process.exit(1);
}

// PowerShell `Out-File -Encoding utf8` writes a BOM that JSON.parse can't handle. Strip it.
const manifestText = fs.readFileSync(manifestPath, "utf-8").replace(/^﻿/, "");
const manifest = JSON.parse(manifestText) as Manifest;
console.log(
  `Loaded manifest (${manifest.deals.length} client folders, generated ${manifest.generatedAt})`
);
if (dryRun) console.log("(DRY RUN — no DB writes)");

const stats = {
  dealsCreated: 0,
  dealsExisting: 0,
  documentsCreated: 0,
  documentsExisting: 0,
  filesSkipped: 0,
};

for (const md of manifest.deals) {
  const sourceFile = `Bob.zip:${md.year}/${md.client}`;
  const folderPath = `Bob.zip:Bob/${md.year}/${md.client}`;

  // Upsert deal by sourceFile (each year/client is its own deal even if the
  // same client recurs across years — engagements are year-bound).
  let dealId: number;
  const existing = db
    .select()
    .from(deals)
    .where(eq(deals.sourceFile, sourceFile))
    .get();

  if (existing) {
    dealId = existing.id;
    stats.dealsExisting++;
  } else if (dryRun) {
    dealId = -1; // placeholder for dry-run logging only
    stats.dealsCreated++;
  } else {
    const inserted = db
      .insert(deals)
      .values({
        name: `${md.client} (${md.year})`,
        status: statusForYear(md.year),
        sourceFile,
        aiSummary: `Imported from ${manifest.zipPath} — ${md.files.length} document${
          md.files.length === 1 ? "" : "s"
        } in ${md.year}/${md.client}.`,
      })
      .returning()
      .get();
    dealId = inserted.id;
    stats.dealsCreated++;
  }

  // Upsert each document by (dealId, filename) — relative path inside the
  // client folder. Subfolder files keep their relative path as the filename
  // so they don't collide with a same-named file at the root.
  for (const f of md.files) {
    if (SKIP_EXTS.has(f.ext)) {
      stats.filesSkipped++;
      continue;
    }
    const filename = f.path; // relative to client folder
    const fileType = fileTypeOf(f.ext);

    if (dryRun) {
      stats.documentsCreated++;
      continue;
    }

    if (dealId === -1) continue; // shouldn't reach here outside dry-run

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
        boxModifiedAt: f.lastWrite,
        status: "pending",
        dealId,
      })
      .run();
    stats.documentsCreated++;
  }
}

console.log("\nResults:");
console.log(`  deals created:     ${stats.dealsCreated}`);
console.log(`  deals existing:    ${stats.dealsExisting}`);
console.log(`  documents created: ${stats.documentsCreated}`);
console.log(`  documents existing:${stats.documentsExisting}`);
console.log(`  files skipped:     ${stats.filesSkipped}`);

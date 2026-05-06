/**
 * Batch-uploads PDFs from Bob (1).zip to Railway.
 * Priority: everything in Tenant Tracking_Upcoming Expirations,
 * then OMs and rent rolls from the rest of the zip.
 * Skips files already in the library (by filename).
 *
 * Usage:
 *   node scripts/batch-upload-pdfs.mjs
 */

import { execSync, execFileSync } from "child_process";
import { mkdirSync, readFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZIP = "C:/Users/RLabar/Downloads/Bob (1).zip";
const EXTRACT_DIR = "C:/Users/RLabar/bobby-bd-dashboard/data/pdf-upload-staging";
const RAILWAY_URL = process.env.RAILWAY_URL || "https://bobby-bd-dashboard-production.up.railway.app";

const VALUABLE_PATTERNS = [
  /offering.memo/i, /_OM\.pdf$/i, /OfferingMem/i,
  /rent.roll/i, /rentroll/i, /RentRoll/i,
  /\bBOV\b/i, /prospectus/i, /marketing.package/i, /SDIG/i,
];

function isValuable(zipPath) {
  if (zipPath.includes("Tenant Tracking_Upcoming Expirations")) return true;
  return VALUABLE_PATTERNS.some((p) => p.test(zipPath));
}

mkdirSync(EXTRACT_DIR, { recursive: true });

// List zip
console.log("Scanning zip...");
const listing = execSync(`unzip -l "${ZIP}"`, { maxBuffer: 10 * 1024 * 1024 }).toString();
const pdfPaths = listing
  .split("\n")
  .filter((l) => l.trim().endsWith(".pdf"))
  .map((l) => l.trim().split(/\s{2,}/).pop()?.trim() ?? "")
  .filter((p) => p && isValuable(p));

console.log(`Found ${pdfPaths.length} PDFs to upload`);

// Existing docs on Railway — only skip ones that are already done
console.log("Checking existing library...");
let doneFilenames = new Set();
try {
  const res = await fetch(`${RAILWAY_URL}/api/documents`);
  if (res.ok) {
    const docs = await res.json();
    for (const d of docs) {
      if (d.status === "done") doneFilenames.add(d.filename);
    }
    console.log(`${doneFilenames.size} already processed (done), will re-upload errors`);
  }
} catch (e) {
  console.warn("Could not check existing docs:", e.message);
}

let uploaded = 0, skipped = 0, failed = 0;

for (const zipPath of pdfPaths) {
  const filename = path.basename(zipPath);

  if (doneFilenames.has(filename)) {
    skipped++;
    continue;
  }

  // Extract to temp file
  const destPath = path.join(EXTRACT_DIR, filename.replace(/[/\\:*?"<>|]/g, "_"));
  try {
    const bytes = execSync(`unzip -p "${ZIP}" "${zipPath}"`, { maxBuffer: 100 * 1024 * 1024 });
    const { writeFileSync } = await import("fs");
    writeFileSync(destPath, bytes);
  } catch (e) {
    console.error(`  EXTRACT FAIL: ${filename} — ${e.message.slice(0, 60)}`);
    failed++;
    continue;
  }

  // Upload: multipart for small files, JSON+base64 for large ones (>=8MB)
  // because Next App Router formData() parser fails on big multipart bodies.
  // Skip raw files >30MB — they exceed Anthropic's 32MB PDF cap (after base64 ≈ 40MB).
  const RAW_MAX = 30 * 1024 * 1024;
  const JSON_THRESHOLD = 8 * 1024 * 1024;
  try {
    const bytes = readFileSync(destPath);
    if (bytes.length > RAW_MAX) {
      console.log(`  ! ${filename}: ${(bytes.length/1024/1024).toFixed(1)}MB exceeds Anthropic 32MB PDF cap — skipped`);
      failed++;
      continue;
    }

    let res;
    if (bytes.length >= JSON_THRESHOLD) {
      const base64 = bytes.toString("base64");
      res = await fetch(`${RAILWAY_URL}/api/process-document`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename, base64, fileSize: bytes.length }),
      });
    } else {
      const blob = new Blob([bytes], { type: "application/pdf" });
      const form = new FormData();
      form.append("file", blob, filename);
      res = await fetch(`${RAILWAY_URL}/api/process-document`, {
        method: "POST",
        body: form,
      });
    }

    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { error: text }; }

    if (res.ok || result?.id) {
      console.log(`  ✓ ${filename} → ${result.status ?? "stored"}`);
      uploaded++;
    } else {
      console.log(`  ~ ${filename}: ${result.error ?? res.status} (stored as error)`);
      // Still count as uploaded since doc record is created
      uploaded++;
    }
  } catch (e) {
    console.error(`  ✗ ${filename}: ${e.message}`);
    failed++;
  }

  // Small delay
  await new Promise((r) => setTimeout(r, 800));
}

console.log(`\nDone. Uploaded: ${uploaded}  Skipped (exists): ${skipped}  Failed: ${failed}`);
console.log("Note: PDFs stored as 'error' status will be reprocessed once API credits are topped up.");

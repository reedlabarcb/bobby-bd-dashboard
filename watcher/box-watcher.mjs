#!/usr/bin/env node
// Bobby BD Box Watcher
//
// Watches a local folder (typically a Box Drive synced folder) for new PDFs and
// uploads them to the Bobby BD Dashboard for AI processing. Zero external deps —
// Node 18+ provides fetch, FormData, and Blob natively.
//
// Config is read from env vars (set via start-watcher.bat or shell):
//   WATCH_DIR      absolute path to the folder being watched
//   UPLOAD_URL     https://<railway-domain>/api/process-document
//   UPLOAD_SECRET  shared secret matching the Railway UPLOAD_SECRET env var
//   POLL_MS        optional, default 30000 (30s safety poll in addition to fs.watch)
//   MANIFEST_PATH  optional, default ./.watcher-manifest.json

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const WATCH_DIR = process.env.WATCH_DIR;
const UPLOAD_URL = process.env.UPLOAD_URL;
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || "";
const POLL_MS = Number(process.env.POLL_MS || 30_000);
const MANIFEST_PATH =
  process.env.MANIFEST_PATH ||
  path.join(process.cwd(), ".watcher-manifest.json");

if (!WATCH_DIR || !UPLOAD_URL) {
  console.error(
    "Missing config. Set WATCH_DIR and UPLOAD_URL (and optionally UPLOAD_SECRET) before running."
  );
  process.exit(1);
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveManifest(m) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function findPdfs(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const pdfs = [];
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (e.name.toLowerCase().endsWith(".pdf")) {
      pdfs.push(path.join(dir, e.name));
    }
  }
  return pdfs;
}

async function uploadFile(filePath) {
  const data = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const form = new FormData();
  form.append(
    "file",
    new Blob([data], { type: "application/pdf" }),
    fileName
  );

  const headers = {};
  if (UPLOAD_SECRET) headers["X-Upload-Secret"] = UPLOAD_SECRET;

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function processNew() {
  const manifest = loadManifest();
  let pdfs;
  try {
    pdfs = await findPdfs(WATCH_DIR);
  } catch (err) {
    console.error(`[scan error] ${err.message}`);
    return;
  }

  let newCount = 0;
  for (const pdfPath of pdfs) {
    let hash;
    try {
      hash = hashFile(pdfPath);
    } catch {
      continue; // file probably still being written, try next time
    }
    if (manifest[hash]) continue;

    try {
      console.log(`[upload] ${path.basename(pdfPath)}`);
      const result = await uploadFile(pdfPath);
      manifest[hash] = {
        filename: path.basename(pdfPath),
        uploadedAt: new Date().toISOString(),
        documentId: result?.id ?? null,
      };
      saveManifest(manifest);
      newCount++;
    } catch (err) {
      console.error(`[error]  ${path.basename(pdfPath)}: ${err.message}`);
    }
  }

  if (newCount > 0) console.log(`[done]   ${newCount} new file(s) uploaded`);
}

async function main() {
  console.log("Bobby BD Box Watcher");
  console.log(`Watch dir: ${WATCH_DIR}`);
  console.log(`Upload URL: ${UPLOAD_URL}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Poll: ${POLL_MS}ms`);
  console.log();

  await processNew();

  let debounceTimer = null;
  try {
    fs.watch(WATCH_DIR, { persistent: true }, (_eventType, fileName) => {
      if (!fileName || !String(fileName).toLowerCase().endsWith(".pdf")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      // 2s debounce — Box Drive may still be writing the file
      debounceTimer = setTimeout(() => {
        processNew().catch((err) =>
          console.error(`[watch error] ${err.message}`)
        );
      }, 2000);
    });
  } catch (err) {
    console.error(
      `[fs.watch unavailable — relying on polling only] ${err.message}`
    );
  }

  // Safety poll — catches anything fs.watch missed (file rename events, network
  // drives, or intermittent Windows fs.watch reliability issues)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_MS);
    await processNew().catch((err) =>
      console.error(`[poll error] ${err.message}`)
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

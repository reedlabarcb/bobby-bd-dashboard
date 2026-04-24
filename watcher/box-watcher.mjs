#!/usr/bin/env node
// Bobby BD Box Watcher
//
// Watches one or more local folders (typically Box Drive synced folders) for
// new files and uploads them to the Bobby BD Dashboard. Recurses into
// subfolders. Dispatches by file extension:
//   .pdf         → /api/process-document     (OM parsing, lease extraction)
//   .xlsx / .xls → /api/auto-import-contacts (contact upsert by email)
// Zero external deps — Node 18+ provides fetch, FormData, Blob natively.
//
// Config (env vars, set via start-watcher.bat or shell):
//   WATCH_DIRS      comma-separated absolute paths (preferred, plural)
//   WATCH_DIR       single absolute path (legacy, still accepted)
//   UPLOAD_BASE     https://<railway-domain>  (no trailing slash, no /api)
//   UPLOAD_SECRET   shared secret matching Railway's UPLOAD_SECRET env var
//   POLL_MS         optional, default 30000
//   MANIFEST_PATH   optional, default ./.watcher-manifest.json

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const WATCH_DIRS = (process.env.WATCH_DIRS || process.env.WATCH_DIR || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const UPLOAD_BASE = (process.env.UPLOAD_BASE || "").replace(/\/$/, "");
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || "";
const POLL_MS = Number(process.env.POLL_MS || 30_000);
const MANIFEST_PATH =
  process.env.MANIFEST_PATH ||
  path.join(process.cwd(), ".watcher-manifest.json");

if (WATCH_DIRS.length === 0 || !UPLOAD_BASE) {
  console.error(
    "Missing config. Set WATCH_DIRS (comma-separated) and UPLOAD_BASE before running."
  );
  process.exit(1);
}

// --- Routing by extension ---
const ROUTES = {
  ".pdf": `${UPLOAD_BASE}/api/process-document`,
  ".xlsx": `${UPLOAD_BASE}/api/auto-import-contacts`,
  ".xls": `${UPLOAD_BASE}/api/auto-import-contacts`,
};

function routeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ROUTES[ext] || null;
}

// --- Manifest ---
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

// --- Recursive directory walk ---
function isIgnorable(name) {
  if (name.startsWith(".")) return true; // hidden
  if (name.startsWith("~$")) return true; // Office temp/lock files
  if (name.toLowerCase() === "desktop.ini") return true;
  if (name.toLowerCase() === "thumbs.db") return true;
  return false;
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (isIgnorable(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && routeFor(full)) {
      out.push(full);
    }
  }
  return out;
}

// --- Upload ---
async function uploadFile(filePath) {
  const url = routeFor(filePath);
  if (!url) return null;

  const data = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".pdf"
      ? "application/pdf"
      : ext === ".xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel";

  const form = new FormData();
  form.append("file", new Blob([data], { type: mime }), fileName);

  const headers = {};
  if (UPLOAD_SECRET) headers["X-Upload-Secret"] = UPLOAD_SECRET;

  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function processNew() {
  const manifest = loadManifest();
  let allFiles = [];
  for (const dir of WATCH_DIRS) {
    const files = await walk(dir);
    allFiles = allFiles.concat(files);
  }

  let newCount = 0;
  for (const filePath of allFiles) {
    let hash;
    try {
      hash = hashFile(filePath);
    } catch {
      continue; // file may be mid-write, try next pass
    }
    if (manifest[hash]) continue;

    try {
      const rel = path.basename(filePath);
      console.log(`[upload] ${rel}`);
      const result = await uploadFile(filePath);
      manifest[hash] = {
        path: filePath,
        filename: rel,
        uploadedAt: new Date().toISOString(),
        route: routeFor(filePath),
        result: result
          ? {
              id: result.id ?? null,
              imported: result.imported ?? undefined,
              updated: result.updated ?? undefined,
            }
          : null,
      };
      saveManifest(manifest);
      newCount++;
    } catch (err) {
      console.error(`[error]  ${path.basename(filePath)}: ${err.message}`);
    }
  }

  if (newCount > 0) console.log(`[done]   ${newCount} new file(s)`);
}

// --- Main ---
async function main() {
  console.log("Bobby BD Box Watcher");
  console.log(`Watching ${WATCH_DIRS.length} folder(s):`);
  for (const d of WATCH_DIRS) console.log(`  - ${d}`);
  console.log(`Upload base: ${UPLOAD_BASE}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Poll: ${POLL_MS}ms`);
  console.log();

  await processNew();

  const timers = new Map();
  for (const dir of WATCH_DIRS) {
    try {
      fs.watch(dir, { persistent: true, recursive: true }, (_type, name) => {
        if (!name) return;
        const ext = path.extname(String(name)).toLowerCase();
        if (!ROUTES[ext]) return;
        if (isIgnorable(path.basename(String(name)))) return;
        const key = dir;
        if (timers.has(key)) clearTimeout(timers.get(key));
        timers.set(
          key,
          setTimeout(() => {
            processNew().catch((err) =>
              console.error(`[watch error] ${err.message}`)
            );
          }, 2000)
        );
      });
    } catch (err) {
      console.error(`[fs.watch failed for ${dir}] ${err.message} — polling only`);
    }
  }

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

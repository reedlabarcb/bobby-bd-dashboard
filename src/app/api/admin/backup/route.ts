import { getSqliteRaw } from "@/lib/db";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || "/data/bobby.db";
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");

// Snapshot the SQLite database via VACUUM INTO. Atomic, can run while the
// DB is in use, produces a clean copy ~= the original size.
export async function POST() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `bobby-${ts}.db`);

  const sqlite = getSqliteRaw();
  // VACUUM INTO is single-quoted SQL literal — escape any embedded quote.
  sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

  const stat = fs.statSync(backupPath);
  return NextResponse.json({
    ok: true,
    path: backupPath,
    filename: path.basename(backupPath),
    sizeBytes: stat.size,
    sizeMb: +(stat.size / 1024 / 1024).toFixed(2),
    ts,
  });
}

// List existing backups so we can see retention + restore candidates.
export async function GET() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return NextResponse.json({ backups: [], dir: BACKUP_DIR });
  }
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((name) => {
      const full = path.join(BACKUP_DIR, name);
      const stat = fs.statSync(full);
      return {
        name,
        sizeBytes: stat.size,
        sizeMb: +(stat.size / 1024 / 1024).toFixed(2),
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return NextResponse.json({ backups: files, dir: BACKUP_DIR });
}

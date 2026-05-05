import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || "/data/bobby.db";
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");

// Stream a backup file off Railway so it can be saved locally / offsite.
// GET /api/admin/backup/<filename>  — returns the .db file as octet-stream.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // Defensive: only allow filenames matching our own naming pattern, no path traversal.
  if (!/^bobby-[\w.\-T:]+\.db$/.test(name)) {
    return NextResponse.json({ error: "invalid backup name" }, { status: 400 });
  }
  const full = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const buffer = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

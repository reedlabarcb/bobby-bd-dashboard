import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath = process.env.DB_PATH || (
  process.env.NODE_ENV === "production"
    ? "/data/bobby.db"
    : path.join(process.cwd(), "data", "bobby.db")
);

// Lazy connection. Merely importing `db` does NOT open the database — that
// happens on first access. This matters at build time: Next.js 16 spawns ~28
// parallel workers to collect page-config metadata, and if each one opens the
// SQLite file simultaneously they race on the WAL-mode pragma and one fails
// with "database is locked".
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

function connect() {
  if (_db) return _db;

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");

  _db = drizzle(_sqlite, { schema });
  return _db;
}

// Escape hatch for arbitrary read-only SQL (the /api/ask natural-language
// endpoint). Returns the underlying better-sqlite3 connection.
export function getSqliteRaw(): Database.Database {
  connect();
  if (!_sqlite) throw new Error("sqlite connection not initialized");
  return _sqlite;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const conn = connect();
    const value = conn[prop as keyof DrizzleDb];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(conn) : value;
  },
}) as DrizzleDb;

export { schema };

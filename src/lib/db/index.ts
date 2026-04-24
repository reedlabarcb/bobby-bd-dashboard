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

function connect() {
  if (_db) return _db;

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });
  return _db;
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

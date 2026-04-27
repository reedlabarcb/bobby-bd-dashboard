import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.DB_PATH || (
  process.env.NODE_ENV === "production"
    ? "/data/bobby.db"
    : path.join(process.cwd(), "data", "bobby.db")
);

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Create tables directly (simpler than drizzle-kit for SQLite)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    title TEXT,
    type TEXT DEFAULT 'other',
    source TEXT,
    tags TEXT,
    city TEXT,
    state TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    property_type TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    asking_price REAL,
    status TEXT DEFAULT 'prospect',
    source_file TEXT,
    ai_summary TEXT,
    raw_text TEXT,
    lat REAL,
    lng REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER REFERENCES contacts(id),
    deal_id INTEGER REFERENCES deals(id),
    type TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    date TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    status TEXT DEFAULT 'processing',
    records_created INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_enrichments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    source TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_file_id TEXT,
    filename TEXT NOT NULL,
    file_type TEXT,
    box_folder_id TEXT,
    box_folder_path TEXT,
    file_size INTEGER,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    document_type TEXT,
    property_name TEXT,
    property_address TEXT,
    property_city TEXT,
    property_state TEXT,
    property_type TEXT,
    asking_price REAL,
    ai_summary TEXT,
    raw_extracted TEXT,
    deal_id INTEGER REFERENCES deals(id),
    box_modified_at TEXT,
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    credit_rating TEXT,
    parent_company TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    document_id INTEGER REFERENCES documents(id),
    deal_id INTEGER REFERENCES deals(id),
    property_name TEXT,
    property_address TEXT,
    property_city TEXT,
    property_state TEXT,
    property_type TEXT,
    suite_unit TEXT,
    square_feet INTEGER,
    lease_start_date TEXT,
    lease_end_date TEXT,
    months_remaining INTEGER,
    rent_psf REAL,
    annual_rent REAL,
    lease_type TEXT,
    options TEXT,
    escalations TEXT,
    source_file TEXT,
    confidence TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS box_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    watched_folders TEXT,
    last_sync_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    address TEXT NOT NULL,
    city TEXT,
    state TEXT DEFAULT 'CA',
    submarket TEXT,
    district TEXT,
    property_class TEXT,
    property_subtype TEXT,
    property_size_sf INTEGER,
    landlord_name TEXT,
    lat REAL,
    lng REAL,
    source TEXT,
    source_file TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_buildings_address ON buildings(address);
  CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
  CREATE INDEX IF NOT EXISTS idx_contacts_name_company ON contacts(name, company);
`);

// Column additions for existing tables. SQLite has no `ADD COLUMN IF NOT EXISTS`,
// so we attempt each ALTER TABLE and swallow the "duplicate column" error.
function addColumnIfMissing(table: string, column: string, def: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

// contacts — richer contact data
addColumnIfMissing("contacts", "direct_phone", "TEXT");
addColumnIfMissing("contacts", "mobile_phone", "TEXT");
addColumnIfMissing("contacts", "business_type", "TEXT");
addColumnIfMissing("contacts", "source_file", "TEXT");

// buildings — promote landlord to a contact (option C)
addColumnIfMissing("buildings", "landlord_contact_id", "INTEGER REFERENCES contacts(id)");

// leases — fields Bob tracks that OM-parsing didn't populate
addColumnIfMissing("leases", "building_id", "INTEGER REFERENCES buildings(id)");
addColumnIfMissing("leases", "floor", "TEXT");
addColumnIfMissing("leases", "effective_rent", "REAL");
addColumnIfMissing("leases", "transaction_type", "TEXT");
addColumnIfMissing("leases", "ti_allowance", "REAL");
addColumnIfMissing("leases", "free_rent_months", "TEXT");
addColumnIfMissing("leases", "escalation_percent", "REAL");
addColumnIfMissing("leases", "is_sublease", "INTEGER DEFAULT 0");
addColumnIfMissing("leases", "tenant_agent", "TEXT");
addColumnIfMissing("leases", "tenant_agency", "TEXT");
addColumnIfMissing("leases", "listing_agent", "TEXT");
addColumnIfMissing("leases", "listing_agency", "TEXT");
addColumnIfMissing("leases", "notes", "TEXT");

console.log("Database migrated successfully at:", dbPath);
sqlite.close();

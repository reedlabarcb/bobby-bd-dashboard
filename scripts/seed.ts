import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "bobby.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Seed contacts
const insertContact = sqlite.prepare(`
  INSERT INTO contacts (name, email, phone, company, title, type, source, tags, city, state, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const contactData = [
  ["Mike Torres", "mtorres@prologis.com", "(312) 555-0142", "Prologis", "VP of Acquisitions", "buyer", "Referral", '["industrial","logistics"]', "Chicago", "IL", "Active buyer in Midwest industrial. Met at ICSC 2025."],
  ["Sarah Chen", "schen@cbre.com", "(213) 555-0198", "CBRE", "Senior Associate", "broker", "Internal", '["retail","multifamily"]', "Los Angeles", "CA", "Co-broker on several SoCal deals. Reliable on retail comps."],
  ["David Park", "dpark@starwoodcapital.com", "(646) 555-0233", "Starwood Capital", "Managing Director", "buyer", "Conference", '["hospitality","office"]', "New York", "NY", "Looking for select-service hotels in Sun Belt markets. $20M-$80M range."],
  ["Rachel Morrison", "rmorrison@marcusmillichap.com", "(972) 555-0177", "Marcus & Millichap", "First VP", "broker", "Deal", '["multifamily","student-housing"]', "Dallas", "TX", "Top producer in DFW multifamily. Has pocket listings."],
  ["James Whitfield", "jwhitfield@bankofamerica.com", "(704) 555-0301", "Bank of America", "SVP Commercial Lending", "lender", "LinkedIn", '["debt","construction"]', "Charlotte", "NC", "Handles CRE loans $5M-$50M. Quick on term sheets."],
];

for (const c of contactData) {
  insertContact.run(...c);
}

// Seed deals
const insertDeal = sqlite.prepare(`
  INSERT INTO deals (name, property_type, address, city, state, asking_price, status, ai_summary, lat, lng)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const dealData = [
  [
    "Lakewood Distribution Center",
    "industrial",
    "4500 Industrial Blvd",
    "Dallas",
    "TX",
    24500000,
    "active",
    "Class A distribution facility built in 2021 with 250,000 SF, 36' clear height, and full ESFR sprinkler system. Currently 95% leased to two investment-grade tenants with 7+ years remaining. Located within 2 miles of I-35E with strong last-mile logistics fundamentals.",
    32.7767,
    -96.797,
  ],
  [
    "Sunset Harbor Hotel",
    "hospitality",
    "2200 Ocean Drive",
    "Miami Beach",
    "FL",
    42000000,
    "prospect",
    "Boutique luxury hotel with 120 keys on Ocean Drive in South Beach. Recent $8M renovation completed in 2024. RevPAR trending 15% above comp set. Seller motivated due to portfolio rebalancing — potential below-replacement-cost acquisition.",
    25.7825,
    -80.1324,
  ],
];

for (const d of dealData) {
  insertDeal.run(...d);
}

// Seed some activities
const insertActivity = sqlite.prepare(`
  INSERT INTO activities (contact_id, deal_id, type, subject, body, date)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const activityData = [
  [1, 1, "call", "Intro call with Mike Torres", "Discussed the Lakewood distribution center. Mike is interested in the cap rate and tenant credit. Sending OM tomorrow.", "2026-04-15 10:30:00"],
  [3, 2, "email", "Sunset Harbor OM to David Park", "Sent the Sunset Harbor OM and financials. David said his team will review by end of week.", "2026-04-14 14:00:00"],
  [2, null, "meeting", "Coffee with Sarah Chen", "Met at the CBRE office to discuss potential co-brokerage on a new retail listing in West Hollywood.", "2026-04-13 09:00:00"],
  [4, null, "note", "Rachel Morrison — DFW pipeline", "Rachel mentioned she has 3 off-market multifamily deals coming to market in Q2. Following up next week for details.", "2026-04-12 16:45:00"],
  [5, 1, "call", "Financing discussion — Lakewood", "James quoted 6.25% on a 5-year fixed for the Lakewood deal. 65% LTV, 25-year am. Need to compare with other lenders.", "2026-04-11 11:00:00"],
];

for (const a of activityData) {
  insertActivity.run(...a);
}

console.log("Seeded: 5 contacts, 2 deals, 5 activities");
sqlite.close();

/**
 * One-time cleanup: remove broker / brokerage contacts from the DB.
 *
 * Usage:
 *   npx tsx scripts/remove-brokers.ts          # delete after preview
 *   npx tsx scripts/remove-brokers.ts --dry    # preview only
 *
 * Run on Railway production via the Railway CLI / shell once after
 * deploy. Safe to run multiple times — already-clean rows just no-op.
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { contacts, activities, contactEnrichments, buildings } from "../src/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { brokerReason } from "../src/lib/constants/broker-filter";

const DRY = process.argv.includes("--dry");

async function main() {
  const all = db.select({
    id: contacts.id,
    name: contacts.name,
    title: contacts.title,
    company: contacts.company,
    type: contacts.type,
  }).from(contacts).all();

  const toDelete: { id: number; name: string; reason: string }[] = [];
  for (const c of all) {
    const reason = brokerReason({
      name: c.name,
      title: c.title,
      company: c.company,
      type: c.type,
    });
    if (reason) {
      toDelete.push({ id: c.id, name: c.name, reason });
    }
  }

  console.log(`Total contacts:    ${all.length}`);
  console.log(`Broker/brokerage:  ${toDelete.length}`);
  console.log("");
  console.log("Sample (first 25):");
  for (const x of toDelete.slice(0, 25)) {
    console.log(`  - [${x.id}] ${x.name}  (${x.reason})`);
  }
  if (toDelete.length > 25) {
    console.log(`  …and ${toDelete.length - 25} more`);
  }

  if (DRY) {
    console.log("\nDRY RUN — nothing deleted.");
    return;
  }

  if (toDelete.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  const ids = toDelete.map((x) => x.id);
  console.log("\nClearing FK references before delete…");

  // activities.contact_id and buildings.landlord_contact_id are nullable —
  // we can re-point those to null and keep the history intact.
  // contact_enrichments.contact_id is NOT NULL, so we delete those rows
  // (they're per-attempt enrichment payloads — no value once the contact is gone).
  const chunkSize = 500;
  let activitiesCleared = 0;
  let enrichmentsDeleted = 0;
  let buildingsCleared = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    activitiesCleared += db.update(activities).set({ contactId: null }).where(inArray(activities.contactId, chunk)).run().changes;
    enrichmentsDeleted += db.delete(contactEnrichments).where(inArray(contactEnrichments.contactId, chunk)).run().changes;
    buildingsCleared += db.update(buildings).set({ landlordContactId: null }).where(inArray(buildings.landlordContactId, chunk)).run().changes;
  }
  console.log(`activities.contact_id → NULL: ${activitiesCleared} rows`);
  console.log(`contact_enrichments deleted:   ${enrichmentsDeleted} rows`);
  console.log(`buildings.landlord_contact_id → NULL: ${buildingsCleared} rows`);

  console.log("Deleting broker contacts…");
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = db.delete(contacts).where(inArray(contacts.id, chunk)).run();
    deleted += res.changes;
  }
  console.log(`Deleted ${deleted} broker contacts.`);

  // Sanity: any remaining brokers?
  const remaining = db.select({
    id: contacts.id, name: contacts.name, title: contacts.title, company: contacts.company, type: contacts.type,
  }).from(contacts).all();
  const stillDirty = remaining.filter((c) =>
    brokerReason({ name: c.name, title: c.title, company: c.company, type: c.type }),
  );
  console.log(`Post-clean: ${remaining.length} contacts remain, ${stillDirty.length} still match broker filter.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  title: text("title"),
  type: text("type", { enum: ["buyer", "seller", "broker", "lender", "other"] }).default("other"),
  source: text("source"),
  tags: text("tags"), // JSON array stored as text
  city: text("city"),
  state: text("state"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  propertyType: text("property_type"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  askingPrice: real("asking_price"),
  status: text("status", { enum: ["prospect", "active", "closed", "dead"] }).default("prospect"),
  sourceFile: text("source_file"),
  aiSummary: text("ai_summary"),
  rawText: text("raw_text"),
  lat: real("lat"),
  lng: real("lng"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  type: text("type", { enum: ["call", "email", "meeting", "note"] }).notNull(),
  subject: text("subject"),
  body: text("body"),
  date: text("date").default(sql`(datetime('now'))`),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  fileType: text("file_type", { enum: ["excel", "pdf"] }).notNull(),
  status: text("status", { enum: ["processing", "done", "error"] }).default("processing"),
  recordsCreated: integer("records_created").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const contactEnrichments = sqliteTable("contact_enrichments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").references(() => contacts.id).notNull(),
  source: text("source").notNull(), // apollo, hunter, apify, claude
  rawJson: text("raw_json").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// Types
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type ContactEnrichment = typeof contactEnrichments.$inferSelect;

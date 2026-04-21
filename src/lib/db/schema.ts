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

// === Box / Document Intelligence ===

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  boxFileId: text("box_file_id"), // null if uploaded directly
  filename: text("filename").notNull(),
  fileType: text("file_type"), // pdf, xlsx, docx
  boxFolderId: text("box_folder_id"),
  boxFolderPath: text("box_folder_path"),
  fileSize: integer("file_size"),
  status: text("status", { enum: ["pending", "processing", "done", "error"] }).default("pending"),
  errorMessage: text("error_message"),
  // Extracted metadata
  documentType: text("document_type"), // om, rent_roll, lease_abstract, market_report, other
  propertyName: text("property_name"),
  propertyAddress: text("property_address"),
  propertyCity: text("property_city"),
  propertyState: text("property_state"),
  propertyType: text("property_type"), // office, retail, industrial, multifamily, etc.
  askingPrice: real("asking_price"),
  aiSummary: text("ai_summary"),
  rawExtracted: text("raw_extracted"), // full JSON of everything Claude extracted
  dealId: integer("deal_id").references(() => deals.id), // link to deal if one was created
  boxModifiedAt: text("box_modified_at"),
  processedAt: text("processed_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  industry: text("industry"),
  creditRating: text("credit_rating"), // investment-grade, national, regional, local
  parentCompany: text("parent_company"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const leases = sqliteTable("leases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  documentId: integer("document_id").references(() => documents.id),
  dealId: integer("deal_id").references(() => deals.id),
  // Property info
  propertyName: text("property_name"),
  propertyAddress: text("property_address"),
  propertyCity: text("property_city"),
  propertyState: text("property_state"),
  propertyType: text("property_type"),
  // Lease terms
  suiteUnit: text("suite_unit"),
  squareFeet: integer("square_feet"),
  leaseStartDate: text("lease_start_date"),
  leaseEndDate: text("lease_end_date"), // THE KEY FIELD — expiration date
  monthsRemaining: integer("months_remaining"), // computed on extraction
  rentPsf: real("rent_psf"), // rent per square foot
  annualRent: real("annual_rent"),
  leaseType: text("lease_type"), // NNN, gross, modified_gross, ground
  options: text("options"), // renewal options, expansion rights, etc.
  escalations: text("escalations"), // rent escalation terms
  // Source
  sourceFile: text("source_file"),
  confidence: text("confidence"), // high, medium, low — how confident Claude is in extraction
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const boxConfig = sqliteTable("box_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: text("expires_at"),
  watchedFolders: text("watched_folders"), // JSON array of folder IDs
  lastSyncAt: text("last_sync_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// Types
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Lease = typeof leases.$inferSelect;
export type NewLease = typeof leases.$inferInsert;
export type BoxConfig = typeof boxConfig.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type ContactEnrichment = typeof contactEnrichments.$inferSelect;

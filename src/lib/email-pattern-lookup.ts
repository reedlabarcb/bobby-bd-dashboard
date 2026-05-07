/**
 * DB-side helper: find existing contacts with confirmed emails at a
 * given company / domain and return them as (name, email) pairs to
 * feed the pattern-matcher.
 */

import { db } from "@/lib/db";
import { contacts as contactsTable } from "@/lib/db/schema";
import { and, eq, like, ne, isNotNull } from "drizzle-orm";

export type KnownContact = { name: string; email: string };

/**
 * Pull confirmed (non-empty) emails from contacts that share a company
 * with the target. excludeContactId skips the contact we're searching
 * for so we don't try to learn a pattern from an empty placeholder.
 */
export function getKnownContactsAtCompany(
  company: string,
  excludeContactId?: number,
): KnownContact[] {
  if (!company) return [];
  const trimmed = company.trim().toLowerCase();
  if (!trimmed) return [];

  const where = excludeContactId !== undefined
    ? and(
        isNotNull(contactsTable.email),
        ne(contactsTable.id, excludeContactId),
        like(contactsTable.company, company.trim()),
      )
    : and(
        isNotNull(contactsTable.email),
        like(contactsTable.company, company.trim()),
      );

  const rows = db
    .select({
      name: contactsTable.name,
      email: contactsTable.email,
      company: contactsTable.company,
    })
    .from(contactsTable)
    .where(where)
    .all();

  return rows
    .filter((r) => r.email && r.email.length > 3 && r.name)
    .filter((r) => (r.company ?? "").trim().toLowerCase() === trimmed)
    .map((r) => ({ name: r.name as string, email: r.email as string }));
}

/**
 * Pull confirmed emails at a given domain across the whole DB. Used
 * when we have a domain but the company name on the target row may
 * not match other rows exactly (subsidiaries, dba, etc).
 */
export function getKnownContactsAtDomain(domain: string): KnownContact[] {
  if (!domain) return [];
  const dom = domain.toLowerCase();
  const rows = db
    .select({
      name: contactsTable.name,
      email: contactsTable.email,
    })
    .from(contactsTable)
    .where(eq(contactsTable.email, contactsTable.email)) // tautology; we filter in JS
    .all();

  return rows
    .filter((r) => r.email && r.name)
    .filter((r) => (r.email as string).toLowerCase().endsWith(`@${dom}`))
    .map((r) => ({ name: r.name as string, email: r.email as string }));
}

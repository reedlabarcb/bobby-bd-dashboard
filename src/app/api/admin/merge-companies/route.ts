/**
 * Admin endpoint — collapse duplicate company spellings in the contacts
 * table by rewriting each contact's `company` field to the canonical
 * display name for its canonical key.
 *
 *   "Jensen Hughes Inc.", "Jensen Hughes" → both become "Jensen Hughes Inc."
 *
 * Body: {confirm: "MERGE-COMPANIES"} — required for the actual write.
 * Header: x-upload-secret: <UPLOAD_SECRET>
 *
 * Dry-run without confirm returns the proposed merges so you can review
 * before running.
 */

import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companyKey, pickDisplayName } from "@/lib/company-norm";

export async function POST(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const auth = request.headers.get("x-upload-secret");
    if (auth !== serverSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: { confirm?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* dry run */
  }
  const confirmed = body.confirm === "MERGE-COMPANIES";

  // Walk every non-null `company` value, group by canonical key.
  const rows = db
    .select({ id: contacts.id, company: contacts.company })
    .from(contacts)
    .where(isNotNull(contacts.company))
    .all();

  const byKey = new Map<string, { canonical: string; variants: Set<string>; ids: number[] }>();
  for (const r of rows) {
    const company = r.company?.trim();
    if (!company) continue;
    const key = companyKey(company);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { canonical: company, variants: new Set([company]), ids: [r.id] };
      byKey.set(key, entry);
    } else {
      entry.variants.add(company);
      entry.ids.push(r.id);
    }
  }

  // Decide canonical display name per group.
  const merges: Array<{
    canonical: string;
    variants: string[];
    rowsAffected: number;
  }> = [];
  for (const entry of byKey.values()) {
    if (entry.variants.size <= 1) continue;
    const canonical = pickDisplayName(Array.from(entry.variants));
    entry.canonical = canonical;
    // Count only the rows whose company doesn't already equal canonical.
    let affected = 0;
    for (const r of rows) {
      if (entry.ids.includes(r.id) && r.company?.trim() !== canonical) affected++;
    }
    if (affected > 0) {
      merges.push({
        canonical,
        variants: Array.from(entry.variants),
        rowsAffected: affected,
      });
    }
  }

  if (!confirmed) {
    return NextResponse.json({
      dryRun: true,
      totalGroupsWithVariants: merges.length,
      totalRowsThatWouldChange: merges.reduce((s, m) => s + m.rowsAffected, 0),
      sample: merges.slice(0, 25),
      hint: 'send {"confirm":"MERGE-COMPANIES"} in the body to actually run',
    });
  }

  let updated = 0;
  for (const m of merges) {
    for (const variant of m.variants) {
      if (variant === m.canonical) continue;
      const res = db
        .update(contacts)
        .set({ company: m.canonical })
        .where(eq(contacts.company, variant))
        .run();
      updated += res.changes;
    }
  }

  return NextResponse.json({
    ok: true,
    groupsMerged: merges.length,
    rowsRewritten: updated,
  });
}

/**
 * POST /api/deep-search-person
 *
 * Exhaustive single-contact research. Runs every available source plus
 * email-pattern matching against existing DB contacts at the same
 * domain. Does NOT save to the contact record — returns structured
 * findings for the user to review and explicitly apply.
 *
 * Inputs (one of):
 *   { contactId: number }  — pulls the contact and uses its name/company
 *   { name: string, company?: string }  — ad-hoc lookup
 *
 * Output:
 *   { name, title, company,
 *     email, emailConfidence,
 *     predictedEmail, predictedEmailConfidence,
 *     phone, linkedinUrl, city, state,
 *     summary, sources, rawFindings }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contacts as contactsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { findEmail, verifyEmail, domainSearch } from "@/lib/api/hunter";
import { enrichPerson as pdlEnrichPerson } from "@/lib/api/pdl";
import { scrapeLinkedIn } from "@/lib/api/apify";
import { searchPerson, AnthropicCreditsError } from "@/lib/api/claude-web-search";
import {
  applyPattern,
  chooseMajorityPattern,
  splitName,
} from "@/lib/email-patterns";
import {
  getKnownContactsAtCompany,
  getKnownContactsAtDomain,
} from "@/lib/email-pattern-lookup";

type RawFindings = {
  hunter?: unknown;
  pdl?: unknown;
  apify?: unknown;
  webSearch?: unknown;
  emailPattern?: unknown;
};

function pickFirst<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v) return v as T;
  return null;
}

/**
 * Coerce a value to a string-or-null. Drops booleans, numbers, objects —
 * occasionally Claude web_search returns `true` instead of a string for
 * an unknown field, and shipping that to a TEXT column in SQLite blows
 * up the PUT.
 */
function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at < 0 ? null : email.slice(at + 1).toLowerCase();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contactId?: number;
      name?: string;
      company?: string;
    };

    let name = body.name?.trim() ?? "";
    let company = body.company?.trim() ?? "";
    let existingEmail: string | null = null;
    let linkedinUrl: string | null = null;
    let contactId: number | undefined = body.contactId;

    if (contactId) {
      const c = db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).get();
      if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      name = name || c.name;
      company = company || c.company || "";
      existingEmail = c.email ?? null;
      const m = c.notes?.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i)?.[0];
      if (m) linkedinUrl = `https://www.${m}`;
    }
    if (!name) {
      return NextResponse.json({ error: "name (or contactId) required" }, { status: 400 });
    }

    const split = splitName(name);
    const sources: string[] = [];
    const errors: string[] = [];
    const notFound: string[] = [];
    const rawFindings: RawFindings = {};

    // ─── Hunter find-email + verify ────────────────────────────
    let hunterFind: { email?: string; score?: number } | null = null;
    if (process.env.HUNTER_API_KEY && company) {
      try {
        const found = await findEmail(name, { company });
        rawFindings.hunter = found;
        hunterFind = found as { email?: string; score?: number };
        if (hunterFind.email) sources.push("hunter");
      } catch (e) {
        errors.push(`Hunter find-email: ${e instanceof Error ? e.message : "failed"}`);
      }
    } else if (!process.env.HUNTER_API_KEY) {
      notFound.push("Hunter not configured");
    }

    // ─── PDL enrichPerson ──────────────────────────────────────
    let pdlHit: Awaited<ReturnType<typeof pdlEnrichPerson>> | null = null;
    if (process.env.PDL_API_KEY && company) {
      try {
        pdlHit = await pdlEnrichPerson(name, company, existingEmail || undefined);
        rawFindings.pdl = pdlHit;
        if (pdlHit) sources.push("pdl");
        else notFound.push(`PDL: no match for "${name}" at "${company}"`);
      } catch (e) {
        errors.push(`PDL: ${e instanceof Error ? e.message : "failed"}`);
      }
    } else if (!process.env.PDL_API_KEY) {
      notFound.push("PDL not configured");
    }

    // ─── Apify (only when LinkedIn URL present) ────────────────
    let apifyHit: Awaited<ReturnType<typeof scrapeLinkedIn>> | null = null;
    if (linkedinUrl) {
      if (process.env.APIFY_API_KEY) {
        try {
          apifyHit = await scrapeLinkedIn(linkedinUrl);
          rawFindings.apify = apifyHit;
          sources.push("apify");
        } catch (e) {
          errors.push(`Apify: ${e instanceof Error ? e.message : "failed"}`);
        }
      } else {
        notFound.push("Apify not configured (have LinkedIn URL but can't scrape)");
      }
    }

    // ─── Claude web_search ────────────────────────────────────
    let webFindings: Awaited<ReturnType<typeof searchPerson>> = { findings: {}, raw: [] };
    if (process.env.ANTHROPIC_API_KEY) {
      const queries = [
        `${name} ${company}`,
        `${name} ${company} email`,
        `${name} ${company} phone`,
        `${name} real estate`,
        `site:linkedin.com "${name}" "${company}"`,
      ];
      try {
        webFindings = await searchPerson(queries);
        rawFindings.webSearch = webFindings.raw;
        if (Object.keys(webFindings.findings).length > 0) sources.push("web_search");
      } catch (e) {
        if (e instanceof AnthropicCreditsError) {
          notFound.push("AI search unavailable — top up credits at console.anthropic.com");
        } else {
          errors.push(`web_search: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
    } else {
      notFound.push("Claude not configured");
    }

    // ─── Merge into a single record ────────────────────────────
    const apifyEmail = apifyHit?.email ?? null;
    const apifyPhone = apifyHit?.phone ?? null;
    const apifyTitle = apifyHit?.headline ?? apifyHit?.currentRole ?? null;
    const [apifyCity, apifyState] = (apifyHit?.location ?? "").split(",").map((s) => s.trim());

    // All five fields go to TEXT columns — coerce strictly to string|null
    // so a stray boolean from web_search can never leak into the DB.
    const email = asString(pickFirst(
      existingEmail,
      hunterFind?.email,
      pdlHit?.email,
      apifyEmail,
      webFindings.findings.email ?? null,
    ));
    const phone = asString(pickFirst(
      pdlHit?.phone,
      apifyPhone,
      webFindings.findings.phone ?? null,
    ));
    const title = asString(pickFirst(
      pdlHit?.title,
      apifyTitle,
      webFindings.findings.title ?? null,
    ));
    const li = asString(pickFirst(
      linkedinUrl,
      pdlHit?.linkedinUrl,
      webFindings.findings.linkedinUrl ?? null,
    ));
    const city = asString(pickFirst(pdlHit?.city, apifyCity ?? null, webFindings.findings.city ?? null));
    const state = asString(pickFirst(pdlHit?.state, apifyState ?? null, webFindings.findings.state ?? null));

    // ─── Email-confidence ──────────────────────────────────────
    let emailConfidence: "verified" | "found-unverified" | "none" = email ? "found-unverified" : "none";
    if (email && process.env.HUNTER_API_KEY) {
      try {
        const v = await verifyEmail(email);
        if (v.result === "deliverable") emailConfidence = "verified";
      } catch {
        /* keep found-unverified */
      }
    }

    // ─── Email-pattern projection ──────────────────────────────
    let predictedEmail: string | null = null;
    let predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null = null;
    if (!email && split && company) {
      // Build a known-contacts pool from same-company DB rows + Hunter
      // domain-search results (which may surface emails not yet in our DB).
      const known = getKnownContactsAtCompany(company, contactId);
      // If we know a domain (from Hunter hit or the existing email), also
      // sweep the DB for any email at that domain.
      const knownDomain =
        extractDomain(hunterFind?.email ?? null) ||
        extractDomain(pdlHit?.email ?? null);
      if (knownDomain) {
        for (const k of getKnownContactsAtDomain(knownDomain)) {
          if (!known.some((kk) => kk.email.toLowerCase() === k.email.toLowerCase())) {
            known.push(k);
          }
        }
      }
      // Final fallback: a Hunter domain-search at the company to seed
      // pattern detection from publicly-indexed emails.
      if (known.length === 0 && process.env.HUNTER_API_KEY) {
        try {
          const ds = await domainSearch({ company }, { limit: 50, onlyPersonal: true });
          for (const e of ds.emails) {
            const n = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
            if (n && e.value) known.push({ name: n, email: e.value });
          }
        } catch {
          /* ignore */
        }
      }

      const majority = chooseMajorityPattern(known);
      if (majority) {
        const projected = applyPattern(majority.pattern, name, majority.domain);
        if (projected) {
          predictedEmail = projected;
          rawFindings.emailPattern = {
            pattern: majority.pattern,
            domain: majority.domain,
            supportCount: majority.supportCount,
            sampleSize: known.length,
          };
          // Verify with Hunter when possible.
          if (process.env.HUNTER_API_KEY) {
            try {
              const v = await verifyEmail(projected);
              if (v.result === "deliverable") {
                predictedEmailConfidence = "high — pattern + verified";
              } else {
                predictedEmailConfidence = "medium — pattern unverified";
              }
            } catch {
              predictedEmailConfidence = "medium — pattern unverified";
            }
          } else {
            predictedEmailConfidence = "medium — pattern unverified";
          }
          if (!sources.includes("email_pattern")) sources.push("email_pattern");
        }
      }
    }

    // ─── Summary ────────────────────────────────────────────────
    const facts: string[] = [];
    if (title) facts.push(`${title}`);
    if (company) facts.push(`at ${company}`);
    if (city) facts.push(`based in ${[city, state].filter(Boolean).join(", ")}`);
    if (email) facts.push(`email ${email}`);
    if (predictedEmail && !email) facts.push(`predicted email ${predictedEmail}`);
    if (li) facts.push(`LinkedIn on file`);
    const summary = facts.length === 0
      ? `No public information found for ${name}${company ? ` at ${company}` : ""}.`
      : `${name} is ${facts.join(", ")}.`;

    return NextResponse.json({
      name,
      title,
      company,
      email,
      emailConfidence,
      predictedEmail,
      predictedEmailConfidence,
      phone,
      linkedinUrl: li,
      city,
      state,
      summary,
      sources,
      errors,
      notFound,
      rawFindings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deep search failed" },
      { status: 500 },
    );
  }
}

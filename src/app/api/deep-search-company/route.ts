/**
 * POST /api/deep-search-company
 *
 * Find every person we can at a given company via Hunter + PDL +
 * Claude web_search, then run email-pattern projection on the people
 * we know about who don't yet have an email. Returns the candidate
 * array — does NOT save to DB.
 *
 * Inputs: { company: string, domain?: string }
 *
 * Output:
 *   { people: [...], emailPattern, patternConfidence, errors, notFound }
 */

import { NextResponse } from "next/server";
import { isBroker } from "@/lib/constants/broker-filter";
import { domainSearch, verifyEmail } from "@/lib/api/hunter";
import { searchPeopleAtCompany as pdlSearchPeople } from "@/lib/api/pdl";
import { searchCompany, AnthropicCreditsError } from "@/lib/api/claude-web-search";
import {
  applyPattern,
  chooseMajorityPattern,
} from "@/lib/email-patterns";
import { getKnownContactsAtCompany, getKnownContactsAtDomain } from "@/lib/email-pattern-lookup";

type Person = {
  name: string;
  title: string | null;
  email: string | null;
  emailConfidence: "verified" | "found-unverified" | "none";
  predictedEmail: string | null;
  predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "pdl" | "web_search";
  confidence: number;
};

function dedupKey(p: { name: string; email: string | null }): string {
  if (p.email) return `e:${p.email.toLowerCase()}`;
  return `n:${p.name.toLowerCase().trim()}`;
}

export async function POST(request: Request) {
  try {
    const { company, domain: domainHint } = (await request.json()) as {
      company?: string;
      domain?: string;
    };
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    const errors: string[] = [];
    const notFound: string[] = [];
    const people: Person[] = [];
    const knownPairsForPattern: Array<{ name: string; email: string }> = [];
    let resolvedDomain: string | null = domainHint ?? null;

    // ─── Phase 1a: Hunter domain-search ─────────────────────────
    if (process.env.HUNTER_API_KEY) {
      try {
        const ds = await domainSearch(
          resolvedDomain ? { domain: resolvedDomain } : { company },
          { limit: 50, onlyPersonal: true },
        );
        if (ds.domain) resolvedDomain = ds.domain;
        for (const e of ds.emails) {
          const n = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
          if (!n) continue;
          const p: Person = {
            name: n,
            title: e.position ?? null,
            email: e.value,
            emailConfidence: e.value ? "found-unverified" : "none",
            predictedEmail: null,
            predictedEmailConfidence: null,
            phone: e.phone_number ?? null,
            linkedinUrl: e.linkedin ?? null,
            source: "hunter",
            confidence: e.confidence ?? 0,
          };
          people.push(p);
          if (e.value) knownPairsForPattern.push({ name: n, email: e.value });
        }
        if (ds.emails.length === 0) {
          notFound.push(`Hunter has no email index for ${ds.organization || company}`);
        }
      } catch (e) {
        errors.push(`Hunter: ${e instanceof Error ? e.message : "failed"}`);
      }
    } else {
      notFound.push("Hunter not configured");
    }

    // ─── Phase 1b: PDL searchPeopleAtCompany ───────────────────
    if (process.env.PDL_API_KEY) {
      try {
        const pdlPeople = await pdlSearchPeople(company);
        for (const p of pdlPeople) {
          if (!p.name) continue;
          const key = dedupKey({ name: p.name, email: p.email });
          if (people.some((q) => dedupKey(q) === key)) continue;
          people.push({
            name: p.name,
            title: p.title,
            email: p.email,
            emailConfidence: p.email ? "found-unverified" : "none",
            predictedEmail: null,
            predictedEmailConfidence: null,
            phone: p.phone,
            linkedinUrl: p.linkedinUrl,
            source: "pdl",
            confidence: 70,
          });
          if (p.email) knownPairsForPattern.push({ name: p.name, email: p.email });
        }
        if (pdlPeople.length === 0) notFound.push(`PDL: no people found at "${company}"`);
      } catch (e) {
        errors.push(`PDL: ${e instanceof Error ? e.message : "failed"}`);
      }
    } else {
      notFound.push("PDL not configured");
    }

    // ─── Phase 1c: Claude web_search ───────────────────────────
    if (process.env.ANTHROPIC_API_KEY) {
      const queries = [
        `${company} team site:linkedin.com`,
        `${company} leadership real estate`,
        `${company} leasing director facilities asset manager`,
        `${company} contact directory`,
      ];
      try {
        const web = await searchCompany(queries);
        for (const c of web.candidates) {
          const key = dedupKey({ name: c.name, email: c.email ?? null });
          if (people.some((q) => dedupKey(q) === key)) continue;
          people.push({
            name: c.name,
            title: c.title ?? null,
            email: c.email ?? null,
            emailConfidence: c.email ? "found-unverified" : "none",
            predictedEmail: null,
            predictedEmailConfidence: null,
            phone: c.phone ?? null,
            linkedinUrl: c.linkedinUrl ?? null,
            source: "web_search",
            confidence: 40,
          });
          if (c.email) knownPairsForPattern.push({ name: c.name, email: c.email });
        }
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

    // ─── Phase 2: Email-pattern projection ─────────────────────
    // Pool known pairs from this run + existing DB contacts at the
    // company / domain so we get the strongest possible signal.
    const dbKnown = getKnownContactsAtCompany(company);
    knownPairsForPattern.push(...dbKnown);
    if (resolvedDomain) {
      for (const k of getKnownContactsAtDomain(resolvedDomain)) {
        knownPairsForPattern.push(k);
      }
    }

    const majority = chooseMajorityPattern(knownPairsForPattern);
    let emailPattern: string | null = null;
    let patternConfidence: "verified" | "inferred" | null = null;
    if (majority) {
      // Pretty-print the pattern as the user expects, e.g. firstname.lastname@domain.com
      const labelMap: Record<typeof majority.pattern, string> = {
        "first.last":  "firstname.lastname",
        "first_last":  "firstname_lastname",
        "first-last":  "firstname-lastname",
        "firstlast":   "firstnamelastname",
        "flast":       "flastname",
        "f.last":      "f.lastname",
        "first":       "firstname",
        "last":        "lastname",
        "last.first":  "lastname.firstname",
        "lastfirst":   "lastnamefirstname",
        "lastf":       "lastnamef",
      };
      emailPattern = `${labelMap[majority.pattern]}@${majority.domain}`;
      patternConfidence = majority.supportCount >= 2 ? "verified" : "inferred";

      // Project missing emails on every person in `people`
      for (const p of people) {
        if (p.email) continue;
        const projected = applyPattern(majority.pattern, p.name, majority.domain);
        if (!projected) continue;
        p.predictedEmail = projected;
        if (process.env.HUNTER_API_KEY) {
          try {
            const v = await verifyEmail(projected);
            p.predictedEmailConfidence =
              v.result === "deliverable" ? "high — pattern + verified" : "medium — pattern unverified";
          } catch {
            p.predictedEmailConfidence = "medium — pattern unverified";
          }
        } else {
          p.predictedEmailConfidence = "medium — pattern unverified";
        }
      }
    }

    // Drop broker/brokerage candidates before returning.
    const brokerCount = people.length;
    const cleanPeople = people.filter(
      (p) => !isBroker({ name: p.name, title: p.title, company }),
    );
    const filteredOut = brokerCount - cleanPeople.length;
    if (filteredOut > 0) {
      notFound.push(`Filtered out ${filteredOut} broker/brokerage candidate${filteredOut === 1 ? "" : "s"}`);
    }
    people.length = 0;
    people.push(...cleanPeople);

    // Sort: confirmed-email first, then has-predicted-email, then by confidence
    people.sort((a, b) => {
      const aHas = a.email ? 2 : a.predictedEmail ? 1 : 0;
      const bHas = b.email ? 2 : b.predictedEmail ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      company,
      domain: resolvedDomain,
      people,
      emailPattern,
      patternConfidence,
      counts: {
        hunter: people.filter((p) => p.source === "hunter").length,
        pdl: people.filter((p) => p.source === "pdl").length,
        web_search: people.filter((p) => p.source === "web_search").length,
      },
      errors,
      notFound,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deep search failed" },
      { status: 500 },
    );
  }
}

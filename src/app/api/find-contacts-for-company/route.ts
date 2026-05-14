/**
 * POST /api/find-contacts-for-company
 *
 * People-discovery for a company. Fans out across the four "cheap"
 * deterministic sources in parallel, then falls back to Claude
 * web_search ONLY if every one of them returned zero.
 *
 * Sources, in order of confidence ranking:
 *   1. Hunter   — domain-search   (free tier, fast)
 *   2. PDL      — person/search   (free tier, may 402 when exhausted)
 *   3. Apollo   — people-search   (free tier may 403; ApolloFreeTierError → notFound)
 *   4. Apify    — linkedin-company-employees actor (when key configured)
 *   5. Claude   — web_search      (LAST RESORT — only if 1..4 returned zero)
 *
 * Returns candidates only — does NOT write to the DB. Caller is the
 * leases-page inline panel which lets the user check rows and decide
 * whether to add or run a deeper search next.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { domainSearch } from "@/lib/api/hunter";
import { searchPeopleAtCompany as pdlSearchPeople } from "@/lib/api/pdl";
import {
  searchOrganization as apolloSearchOrg,
  searchPeople as apolloSearchPeople,
  ApolloFreeTierError,
} from "@/lib/api/apollo";
import { scrapeCompanyEmployees } from "@/lib/api/apify";
import { isBroker } from "@/lib/constants/broker-filter";

export type CandidateContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "pdl" | "apollo" | "apify" | "web_search";
  confidence: number; // 0-100
};

function dedupeKey(c: { name: string; email: string | null }): string {
  if (c.email) return `email:${c.email.toLowerCase()}`;
  return `name:${c.name.toLowerCase().trim()}`;
}

type SourceResult = {
  source: CandidateContact["source"];
  candidates: CandidateContact[];
  errors: string[];
  notFound: string[];
  domain?: string;
};

async function runHunter(company: string, domainHint: string | null): Promise<SourceResult> {
  const r: SourceResult = { source: "hunter", candidates: [], errors: [], notFound: [] };
  if (!process.env.HUNTER_API_KEY) {
    r.notFound.push("Hunter not configured");
    return r;
  }
  try {
    const ds = await domainSearch(
      domainHint ? { domain: domainHint } : { company },
      { limit: 50, onlyPersonal: true },
    );
    if (ds.domain) r.domain = ds.domain;
    for (const e of ds.emails) {
      const name = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
      if (!name) continue;
      r.candidates.push({
        name,
        title: e.position ?? null,
        email: e.value,
        phone: e.phone_number ?? null,
        linkedinUrl: e.linkedin ?? null,
        source: "hunter",
        confidence: e.confidence ?? 0,
      });
    }
    if (ds.emails.length === 0) {
      r.notFound.push(`Hunter has no email index for ${ds.organization || company}`);
    }
  } catch (err) {
    r.errors.push(`Hunter: ${err instanceof Error ? err.message : "failed"}`);
  }
  return r;
}

async function runPdl(company: string): Promise<SourceResult> {
  const r: SourceResult = { source: "pdl", candidates: [], errors: [], notFound: [] };
  if (!process.env.PDL_API_KEY) {
    r.notFound.push("PDL not configured");
    return r;
  }
  try {
    const people = await pdlSearchPeople(company);
    for (const p of people) {
      if (!p.name) continue;
      r.candidates.push({
        name: p.name,
        title: p.title,
        email: p.email,
        phone: p.phone,
        linkedinUrl: p.linkedinUrl,
        source: "pdl",
        confidence: 70,
      });
    }
    if (people.length === 0) {
      r.notFound.push(`PDL: no people found at "${company}"`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    if (msg.includes("402")) {
      r.notFound.push("PDL free-tier credits exhausted (402)");
    } else {
      r.errors.push(`PDL: ${msg}`);
    }
  }
  return r;
}

async function runApollo(company: string): Promise<SourceResult> {
  const r: SourceResult = { source: "apollo", candidates: [], errors: [], notFound: [] };
  if (!process.env.APOLLO_API_KEY) {
    r.notFound.push("Apollo not configured");
    return r;
  }
  // Org-search runs first to surface the domain — we attach that to the
  // SourceResult so the orchestrator can hand it to Hunter on a retry
  // or to the UI. We don't await sequentially here; org+people run in
  // parallel inside this branch.
  const [orgResult, peopleResult] = await Promise.allSettled([
    apolloSearchOrg(company),
    apolloSearchPeople({ company }),
  ]);

  if (orgResult.status === "fulfilled" && orgResult.value?.domain) {
    r.domain = orgResult.value.domain;
  } else if (orgResult.status === "rejected") {
    const err = orgResult.reason;
    if (err instanceof ApolloFreeTierError) {
      r.notFound.push("Apollo free-tier limited on organizations/search");
    } else {
      r.errors.push(`Apollo org: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  if (peopleResult.status === "fulfilled") {
    const people = (peopleResult.value.people as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of people) {
      const name =
        (p.name as string | undefined) ??
        [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
      if (!name) continue;
      r.candidates.push({
        name,
        title: (p.title as string | undefined) ?? null,
        email: (p.email as string | undefined) ?? null,
        phone: (p.organization_phone as string | undefined) ?? null,
        linkedinUrl: (p.linkedin_url as string | undefined) ?? null,
        source: "apollo",
        confidence: 60,
      });
    }
    if (people.length === 0) {
      r.notFound.push(`Apollo: no people found at "${company}"`);
    }
  } else {
    const err = peopleResult.reason;
    if (err instanceof ApolloFreeTierError) {
      r.notFound.push("Apollo free-tier limited on people-search");
    } else {
      r.errors.push(`Apollo: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return r;
}

async function runApify(company: string): Promise<SourceResult> {
  const r: SourceResult = { source: "apify", candidates: [], errors: [], notFound: [] };
  if (!process.env.APIFY_API_KEY) {
    r.notFound.push("Apify not configured");
    return r;
  }
  try {
    const employees = await scrapeCompanyEmployees(company, { limit: 25 });
    for (const e of employees) {
      r.candidates.push({
        name: e.name,
        title: e.title,
        email: e.email,
        phone: e.phone,
        linkedinUrl: e.linkedinUrl,
        source: "apify",
        confidence: 75,
      });
    }
    if (employees.length === 0) {
      r.notFound.push(`Apify: no employees found at "${company}"`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    const aborted = err instanceof Error && (err.name === "AbortError" || msg.includes("aborted"));
    if (aborted) {
      r.notFound.push("Apify scrape timed out (>30s)");
    } else {
      r.errors.push(`Apify: ${msg}`);
    }
  }
  return r;
}

export async function POST(request: Request) {
  try {
    const { company, domain: domainHint, city, state, industry } = (await request.json()) as {
      company?: string;
      domain?: string;
      city?: string;
      state?: string;
      industry?: string;
    };
    if (!company) {
      return NextResponse.json({ error: "company required" }, { status: 400 });
    }

    // ─── Fan out the four cheap deterministic sources in parallel.
    // Slowest realistic source: Apify (~10-30s); Hunter/PDL/Apollo
    // are all sub-second. Parallel cuts total wall-time to whoever is
    // slowest, instead of the sum.
    const [hunter, pdl, apollo, apify] = await Promise.all([
      runHunter(company, domainHint ?? null),
      runPdl(company),
      runApollo(company),
      runApify(company),
    ]);

    let resolvedDomain: string | null = domainHint ?? hunter.domain ?? apollo.domain ?? null;
    const candidates: CandidateContact[] = [];
    const errors: string[] = [];
    const notFound: string[] = [];

    for (const r of [hunter, pdl, apollo, apify]) {
      for (const c of r.candidates) {
        const key = dedupeKey(c);
        // Keep the highest-confidence variant when a person is seen by
        // multiple sources. Re-sort downstream.
        const existing = candidates.findIndex((x) => dedupeKey(x) === key);
        if (existing < 0) {
          candidates.push(c);
        } else if (c.confidence > candidates[existing].confidence) {
          candidates[existing] = c;
        }
      }
      errors.push(...r.errors);
      notFound.push(...r.notFound);
    }

    // ─── Last-resort: Claude web_search if every source above came up empty.
    let webSearchUsed = false;
    if (candidates.length === 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const locationHint = [city, state].filter(Boolean).join(", ");
        const prompt = `Find 3-5 senior decision-makers at "${company}"${locationHint ? ` (${locationHint})` : ""}${industry ? ` in the ${industry} industry` : ""}. We are a commercial real estate broker. Prioritize: CEO, President, COO, Director of Real Estate, VP of Operations, Head of Facilities, founders, owners.

Use web search. For each person return: full name, current title, LinkedIn profile URL if findable, the company they work for (to confirm).

Return ONLY valid JSON, no preamble:
{
  "candidates": [
    {"name": "...", "title": "...", "linkedinUrl": "..." or null, "company": "..."}
  ]
}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        let response;
        try {
          response = await anthropic.beta.messages.create(
            {
              model: "claude-sonnet-4-6",
              max_tokens: 1500,
              tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as never],
              messages: [{ role: "user", content: prompt }],
            },
            { signal: controller.signal },
          );
        } finally {
          clearTimeout(timer);
        }
        webSearchUsed = true;

        const textBlocks = response.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;
        const text = textBlocks.map((b) => b.text).join("\n");
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            candidates?: Array<{ name: string; title?: string; linkedinUrl?: string | null; company?: string }>;
          };
          for (const c of parsed.candidates ?? []) {
            const key = dedupeKey({ name: c.name, email: null });
            if (candidates.some((h) => dedupeKey(h) === key)) continue;
            candidates.push({
              name: c.name,
              title: c.title ?? null,
              email: null,
              phone: null,
              linkedinUrl: c.linkedinUrl ?? null,
              source: "web_search",
              confidence: 40,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        const aborted = err instanceof Error && (err.name === "AbortError" || msg.includes("aborted"));
        if (aborted) {
          notFound.push("Web search timed out (>20s) — try again or skip");
        } else if (msg.includes("400") || msg.includes("credit_balance") || msg.includes("balance")) {
          notFound.push("AI search unavailable — top up credits at console.anthropic.com");
        } else {
          errors.push(`Claude web_search: ${msg}`);
        }
      }
    }

    // ─── Broker filter + sort.
    const brokerCount = candidates.length;
    const clean = candidates.filter((c) => !isBroker({ name: c.name, title: c.title, company }));
    const filteredOut = brokerCount - clean.length;
    if (filteredOut > 0) {
      notFound.push(`Filtered out ${filteredOut} broker/brokerage candidate${filteredOut === 1 ? "" : "s"}`);
    }

    clean.sort((a, b) => {
      const aHas = a.email ? 1 : 0;
      const bHas = b.email ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      company,
      domain: resolvedDomain,
      candidates: clean.slice(0, 50),
      webSearchUsed,
      counts: {
        hunter: clean.filter((c) => c.source === "hunter").length,
        pdl: clean.filter((c) => c.source === "pdl").length,
        apollo: clean.filter((c) => c.source === "apollo").length,
        apify: clean.filter((c) => c.source === "apify").length,
        web_search: clean.filter((c) => c.source === "web_search").length,
      },
      errors,
      notFound,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Find contacts failed" },
      { status: 500 },
    );
  }
}

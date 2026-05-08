/**
 * POST /api/find-contacts-for-company
 *
 * Cheap people-discovery for a company. Runs only the no-AI sources by
 * default; Claude web_search fires ONLY when both Hunter and PDL return
 * zero candidates.
 *
 * Sources, in order:
 *   1. Hunter domain-search
 *   2. PDL searchPeopleAtCompany
 *   3. Claude web_search  ← last resort, only if 1 + 2 returned 0
 *
 * Apollo is intentionally NOT used here (free-tier 403s; per memory).
 *
 * Returns candidates only — does NOT write to the DB. Caller is the
 * leases-page inline panel which lets the user check rows and decide
 * whether to add or run a deeper search next.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { domainSearch } from "@/lib/api/hunter";
import { searchPeopleAtCompany as pdlSearchPeople } from "@/lib/api/pdl";
import { isBroker } from "@/lib/constants/broker-filter";

export type CandidateContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "pdl" | "web_search";
  confidence: number; // 0-100
};

function dedupeKey(c: { name: string; email: string | null }): string {
  if (c.email) return `email:${c.email.toLowerCase()}`;
  return `name:${c.name.toLowerCase().trim()}`;
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

    const candidates: CandidateContact[] = [];
    const errors: string[] = [];
    const notFound: string[] = [];
    let resolvedDomain: string | null = domainHint ?? null;

    // ─── 1. Hunter domain-search ───────────────────────────────
    if (process.env.HUNTER_API_KEY) {
      try {
        const ds = await domainSearch(
          resolvedDomain ? { domain: resolvedDomain } : { company },
          { limit: 50, onlyPersonal: true },
        );
        if (ds.domain) resolvedDomain = ds.domain;
        for (const e of ds.emails) {
          const name = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
          if (!name) continue;
          candidates.push({
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
          notFound.push(`Hunter has no email index for ${ds.organization || company}`);
        }
      } catch (err) {
        errors.push(`Hunter: ${err instanceof Error ? err.message : "failed"}`);
      }
    } else {
      notFound.push("Hunter not configured");
    }

    // ─── 2. PDL searchPeopleAtCompany ──────────────────────────
    if (process.env.PDL_API_KEY) {
      try {
        const pdlPeople = await pdlSearchPeople(company);
        for (const p of pdlPeople) {
          if (!p.name) continue;
          const key = dedupeKey({ name: p.name, email: p.email });
          if (candidates.some((c) => dedupeKey(c) === key)) continue;
          candidates.push({
            name: p.name,
            title: p.title,
            email: p.email,
            phone: p.phone,
            linkedinUrl: p.linkedinUrl,
            source: "pdl",
            confidence: 70,
          });
        }
        if (pdlPeople.length === 0) {
          notFound.push(`PDL: no people found at "${company}"`);
        }
      } catch (err) {
        errors.push(`PDL: ${err instanceof Error ? err.message : "failed"}`);
      }
    } else {
      notFound.push("PDL not configured");
    }

    // ─── 3. Claude web_search — LAST RESORT ─────────────────────
    // Only fires if BOTH Hunter and PDL produced zero candidates. This
    // is the cheap-default contract: no Claude credits burned just to
    // surface people who were already in Hunter's index.
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

        // Bound the web_search call so we never blow Railway's proxy
        // gateway timeout (~30s). 20s gives Claude enough time for 2-3
        // queries; if more were needed the cheaper sources should have
        // covered it. AbortController cancels the in-flight request.
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

    // Drop any candidate that looks like a broker — title or name match.
    const brokerCount = candidates.length;
    const cleanCandidates = candidates.filter(
      (c) => !isBroker({ name: c.name, title: c.title, company }),
    );
    const filteredOut = brokerCount - cleanCandidates.length;
    if (filteredOut > 0) {
      notFound.push(`Filtered out ${filteredOut} broker/brokerage candidate${filteredOut === 1 ? "" : "s"}`);
    }
    candidates.length = 0;
    candidates.push(...cleanCandidates);

    // Sort: confirmed-email first, then by confidence, then name
    candidates.sort((a, b) => {
      const aHas = a.email ? 1 : 0;
      const bHas = b.email ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      company,
      domain: resolvedDomain,
      candidates: candidates.slice(0, 25),
      webSearchUsed,
      counts: {
        hunter: candidates.filter((c) => c.source === "hunter").length,
        pdl: candidates.filter((c) => c.source === "pdl").length,
        web_search: candidates.filter((c) => c.source === "web_search").length,
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

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { domainSearch } from "@/lib/api/hunter";
import {
  searchOrganization as apolloSearchOrg,
  searchPeople as apolloSearchPeople,
  ApolloFreeTierError,
} from "@/lib/api/apollo";
import { searchPeopleAtCompany as pdlSearchPeople } from "@/lib/api/pdl";

export type CandidateContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "apollo" | "pdl" | "web_search";
  confidence: number; // 0-100
};

const SENIOR_KEYWORDS = [
  "ceo", "president", "founder", "owner", "principal", "managing",
  "director", "vp", "vice president", "head of", "chief", "partner",
  "real estate", "leasing", "facilit", "operations", "asset",
];

function isSenior(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return SENIOR_KEYWORDS.some((k) => t.includes(k));
}

function dedupeKey(c: { name: string; email: string | null }): string {
  if (c.email) return `email:${c.email.toLowerCase()}`;
  return `name:${c.name.toLowerCase().trim()}`;
}

export async function POST(request: Request) {
  try {
    const { company, domain: domainHint, city, state, industry } = await request.json() as {
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

    // ─── Step 1: Hunter domain-search ────────────────────────────
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
            title: e.position,
            email: e.value,
            phone: e.phone_number,
            linkedinUrl: e.linkedin,
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

    // ─── Step 2: Apollo org-search (get domain) → people-search ──
    if (process.env.APOLLO_API_KEY) {
      try {
        if (!resolvedDomain) {
          const org = await apolloSearchOrg(company);
          if (org?.domain) resolvedDomain = org.domain;
        }
      } catch (err) {
        if (!(err instanceof ApolloFreeTierError)) {
          errors.push(`Apollo org-search: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
      try {
        const people = await apolloSearchPeople({ company });
        const list = (people.people as Array<Record<string, unknown>> | undefined) ?? [];
        for (const p of list) {
          const name =
            (p.name as string | undefined) ??
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
          if (!name) continue;
          const key = dedupeKey({ name, email: (p.email as string | undefined) ?? null });
          if (candidates.some((c) => dedupeKey(c) === key)) continue;
          candidates.push({
            name,
            title: (p.title as string | undefined) ?? null,
            email: (p.email as string | undefined) ?? null,
            phone: (p.organization_phone as string | undefined) ?? null,
            linkedinUrl: (p.linkedin_url as string | undefined) ?? null,
            source: "apollo",
            confidence: 60,
          });
        }
        if (list.length === 0) {
          notFound.push(`Apollo: no people found at "${company}"`);
        }
      } catch (err) {
        if (err instanceof ApolloFreeTierError) {
          notFound.push("Apollo free tier limited (skipping people-search)");
        } else {
          errors.push(`Apollo: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
    } else {
      notFound.push("Apollo not configured");
    }

    // ─── Step 3: PDL searchPeopleAtCompany ───────────────────────
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

    // ─── Step 4: Claude + web_search fallback ────────────────────
    const seniorCount = candidates.filter((c) => isSenior(c.title)).length;
    if (seniorCount < 3 && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const locationHint = [city, state].filter(Boolean).join(", ");
        const prompt = `Find 3-5 senior decision-makers at "${company}"${locationHint ? ` (${locationHint})` : ""}${industry ? ` in the ${industry} industry` : ""}. We are a commercial real estate broker looking to discuss their lease/space needs. Prioritize: CEO, President, COO, Director of Real Estate, VP of Operations, Head of Facilities, founders, owners.

Use web search. For each person return: full name, current title, LinkedIn profile URL if findable, the company they work for (to confirm).

Return ONLY valid JSON, no preamble:
{
  "candidates": [
    {"name": "...", "title": "...", "linkedinUrl": "..." or null, "company": "..."}
  ]
}`;

        const response = await anthropic.beta.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as never],
          messages: [{ role: "user", content: prompt }],
        });

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
        errors.push(`Claude web_search: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    // Sort: senior titles first, then by confidence desc, then name.
    candidates.sort((a, b) => {
      const sa = isSenior(a.title) ? 1 : 0;
      const sb = isSenior(b.title) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      company,
      domain: resolvedDomain,
      candidates: candidates.slice(0, 25),
      counts: {
        hunter: candidates.filter((c) => c.source === "hunter").length,
        apollo: candidates.filter((c) => c.source === "apollo").length,
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

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { domainSearch } from "@/lib/api/hunter";

export type CandidateContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "web_search";
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

export async function POST(request: Request) {
  try {
    const { company, city, state, industry } = await request.json() as {
      company?: string;
      city?: string;
      state?: string;
      industry?: string;
    };
    if (!company) {
      return NextResponse.json({ error: "company required" }, { status: 400 });
    }

    const candidates: CandidateContact[] = [];
    const errors: string[] = [];

    // Step 1: Hunter domain-search — primary source. Up to 50 personal emails
    // with names and titles, sorted by confidence. Free for the first 25/mo.
    if (process.env.HUNTER_API_KEY) {
      try {
        const ds = await domainSearch({ company }, { limit: 50, onlyPersonal: true });
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
      } catch (err) {
        errors.push(`Hunter: ${err instanceof Error ? err.message : "failed"}`);
      }
    } else {
      errors.push("HUNTER_API_KEY not configured (skipping Hunter)");
    }

    // Step 2: if Hunter found <3 senior candidates, ask Claude (web_search)
    // to fill in. CRE outreach wants decision-makers, not whoever's email
    // happens to be public.
    const seniorFromHunter = candidates.filter((c) => isSenior(c.title)).length;
    if (seniorFromHunter < 3 && process.env.ANTHROPIC_API_KEY) {
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

        // Find the final assistant text block (after tool use)
        const textBlocks = response.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;
        const text = textBlocks.map((b) => b.text).join("\n");
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            candidates?: Array<{ name: string; title?: string; linkedinUrl?: string | null; company?: string }>;
          };
          for (const c of parsed.candidates ?? []) {
            // dedup against Hunter results by name (case-insensitive)
            const exists = candidates.some(
              (h) => h.name.toLowerCase().trim() === c.name.toLowerCase().trim(),
            );
            if (exists) continue;
            candidates.push({
              name: c.name,
              title: c.title ?? null,
              email: null,
              phone: null,
              linkedinUrl: c.linkedinUrl ?? null,
              source: "web_search",
              confidence: 0,
            });
          }
        }
      } catch (err) {
        errors.push(`Claude web_search: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    // Sort: senior titles first, then by confidence desc, then by name
    candidates.sort((a, b) => {
      const sa = isSenior(a.title) ? 1 : 0;
      const sb = isSenior(b.title) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      company,
      candidates: candidates.slice(0, 25),
      hunterCount: candidates.filter((c) => c.source === "hunter").length,
      webSearchCount: candidates.filter((c) => c.source === "web_search").length,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Find contacts failed" },
      { status: 500 },
    );
  }
}

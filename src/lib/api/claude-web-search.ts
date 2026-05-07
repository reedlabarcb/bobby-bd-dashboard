/**
 * Helper around Claude beta web_search for Deep Search routes.
 *
 * Runs a list of queries sequentially (Anthropic dislikes parallel
 * web_search calls) and asks Claude to return ONLY structured JSON.
 * Caller decides how to merge findings.
 *
 * Throws AnthropicCreditsError on 400 (out of credits) so callers can
 * surface a "top up credits" message in notFound rather than failing
 * the whole pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";

export class AnthropicCreditsError extends Error {
  constructor(message = "Anthropic credits depleted") {
    super(message);
    this.name = "AnthropicCreditsError";
  }
}

export type WebPersonFinding = {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  source: string; // which query/site surfaced this
};

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Run a single Claude web_search query and return its structured JSON.
 */
async function runOneQuery(
  client: Anthropic,
  query: string,
  schemaInstructions: string,
): Promise<unknown> {
  const prompt = `${schemaInstructions}

Search the web for: ${query}

Return ONLY valid JSON, no preamble, no commentary.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as never],
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("400") || msg.includes("credit_balance") || msg.includes("balance")) {
      throw new AnthropicCreditsError(
        "AI search unavailable — top up credits at console.anthropic.com",
      );
    }
    throw e;
  }
  const blocks = response.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;
  const text = blocks.map((b) => b.text).join("\n");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/**
 * Run several queries about a single person and merge findings.
 * Returns one consolidated record (best non-null value across queries).
 */
export async function searchPerson(
  queries: string[],
): Promise<{ findings: Partial<WebPersonFinding>; raw: unknown[]; error?: string }> {
  const client = getClient();
  if (!client) return { findings: {}, raw: [], error: "ANTHROPIC_API_KEY not configured" };

  const schema = `Return ONLY a JSON object with these keys (use null for unknowns):
{
  "name": string | null,
  "title": string | null,
  "email": string | null,
  "phone": string | null,
  "linkedinUrl": string | null,
  "city": string | null,
  "state": string | null
}`;

  const merged: Partial<WebPersonFinding> = {};
  const raw: unknown[] = [];
  for (const q of queries) {
    try {
      const result = (await runOneQuery(client, q, schema)) as Partial<WebPersonFinding> | null;
      if (!result) continue;
      raw.push({ query: q, result });
      for (const k of ["name", "title", "email", "phone", "linkedinUrl", "city", "state"] as const) {
        const v = result[k];
        if (v && !merged[k]) merged[k] = v;
      }
    } catch (e) {
      if (e instanceof AnthropicCreditsError) throw e;
      // skip a single failing query, keep going
    }
  }
  return { findings: merged, raw };
}

/**
 * Run several queries about people-at-a-company and merge findings.
 * Returns an array of person candidates.
 */
export async function searchCompany(
  queries: string[],
): Promise<{
  candidates: Array<Partial<WebPersonFinding> & { name: string; source: string }>;
  raw: unknown[];
  error?: string;
}> {
  const client = getClient();
  if (!client) return { candidates: [], raw: [], error: "ANTHROPIC_API_KEY not configured" };

  const schema = `Return ONLY a JSON object:
{
  "candidates": [
    {
      "name": string,
      "title": string | null,
      "email": string | null,
      "phone": string | null,
      "linkedinUrl": string | null
    }
  ]
}`;

  const out: Array<Partial<WebPersonFinding> & { name: string; source: string }> = [];
  const raw: unknown[] = [];
  for (const q of queries) {
    try {
      const result = (await runOneQuery(client, q, schema)) as
        | { candidates?: Array<Partial<WebPersonFinding> & { name: string }> }
        | null;
      if (!result?.candidates) continue;
      raw.push({ query: q, result });
      for (const c of result.candidates) {
        if (!c.name) continue;
        out.push({ ...c, source: `web:${q.slice(0, 40)}` });
      }
    } catch (e) {
      if (e instanceof AnthropicCreditsError) throw e;
    }
  }
  return { candidates: out, raw };
}

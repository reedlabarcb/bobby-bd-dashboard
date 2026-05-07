/**
 * Apollo.io integration — uses free-tier-compatible endpoints only.
 *
 * The previous code hit /v1/people/match which is paid-only and 403s on
 * free plans. We now use:
 *   - POST /v1/people/search          — find a person by name + company
 *   - POST /v1/organizations/search   — get company domain (feeds Hunter)
 *
 * All calls fail gracefully — if APOLLO_API_KEY is missing or the call
 * returns 403, callers receive a structured null/error and the pipeline
 * keeps running.
 */

const APOLLO_BASE = "https://api.apollo.io/v1";

export class ApolloFreeTierError extends Error {
  constructor(message = "Apollo free tier limited") {
    super(message);
    this.name = "ApolloFreeTierError";
  }
}

function getKey(): string | null {
  return process.env.APOLLO_API_KEY ?? null;
}

async function apolloFetch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = getKey();
  if (!key) throw new Error("APOLLO_API_KEY not configured");
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    throw new ApolloFreeTierError(
      `Apollo free tier limited (${path} requires paid plan)`,
    );
  }
  if (!res.ok) throw new Error(`Apollo API error: ${res.status}`);
  return res.json();
}

/**
 * Search for a person by name and company. Free-tier-compatible.
 */
export async function searchPeople(query: {
  name?: string;
  company?: string;
  title?: string;
  city?: string;
}): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = { per_page: 5 };
  if (query.name) params.q_person_name = query.name;
  if (query.company) params.q_organization_name = query.company;
  if (query.title) params.person_titles = [query.title];
  if (query.city) params.person_locations = [query.city];
  return apolloFetch("/people/search", params);
}

/**
 * Search for an organization by name. Used to get the company domain so
 * Hunter domain-search can find people inside it.
 *
 * Returns the first matching organization (or null) and exposes its
 * primary domain via the `domain` field.
 */
export async function searchOrganization(
  companyName: string,
): Promise<{
  domain: string | null;
  name: string | null;
  raw: Record<string, unknown>;
} | null> {
  const data = await apolloFetch("/organizations/search", {
    q_organization_name: companyName,
    per_page: 1,
  });
  const orgs = (data.organizations as Array<Record<string, unknown>> | undefined) ?? [];
  if (orgs.length === 0) return null;
  const org = orgs[0];
  return {
    domain:
      (org.primary_domain as string | undefined) ??
      (org.website_url as string | undefined)?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*/, "") ??
      null,
    name: (org.name as string | undefined) ?? null,
    raw: org,
  };
}

/**
 * Look up a person by email. Paid-only — kept for completeness so the
 * route handler can call it inside a try/catch and let it 403 silently.
 */
export async function enrichContact(email: string): Promise<Record<string, unknown>> {
  return apolloFetch("/people/match", { email });
}

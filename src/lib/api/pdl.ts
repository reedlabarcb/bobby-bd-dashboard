/**
 * People Data Labs (PDL) integration.
 *
 * Free tier: 100 lookups / month. Used as the third-position source in
 * the enrichment pipeline (after Apollo + Hunter, before Apify) and as
 * a parallel candidate-source in find-contacts-for-company.
 *
 * Docs: https://docs.peopledatalabs.com/docs/quickstart
 */

const PDL_BASE = "https://api.peopledatalabs.com/v5";

export type PDLPerson = {
  name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
};

export type PDLCompany = {
  name: string | null;
  industry: string | null;
  size: string | null;
  city: string | null;
  state: string | null;
  linkedinUrl: string | null;
  domain: string | null;
};

function getKey(): string | null {
  return process.env.PDL_API_KEY ?? null;
}

function mapPerson(p: Record<string, unknown>): PDLPerson {
  const emails = (p.emails as Array<{ address?: string }> | undefined) ?? [];
  const phones = (p.phone_numbers as string[] | undefined) ?? [];
  const work = p.job_title as string | undefined;
  return {
    name:
      (p.full_name as string | undefined) ??
      [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ??
      null,
    title: work ?? null,
    company: (p.job_company_name as string | undefined) ?? null,
    email:
      (p.work_email as string | undefined) ??
      emails[0]?.address ??
      null,
    phone:
      (p.mobile_phone as string | undefined) ??
      (p.work_phone as string | undefined) ??
      phones[0] ??
      null,
    linkedinUrl:
      (p.linkedin_url as string | undefined) ??
      (p.linkedin_username as string | undefined &&
        `https://www.linkedin.com/in/${p.linkedin_username}`) ??
      null,
    city: (p.location_locality as string | undefined) ?? null,
    state: (p.location_region as string | undefined) ?? null,
  };
}

/**
 * Enrich a single person by name + company (and optional email).
 * Returns null on miss (PDL returns 404 when the person isn't found).
 */
export async function enrichPerson(
  name: string,
  company: string,
  email?: string,
): Promise<PDLPerson | null> {
  const key = getKey();
  if (!key) throw new Error("PDL_API_KEY not configured");

  const params = new URLSearchParams();
  params.set("name", name);
  if (company) params.set("company", company);
  if (email) params.set("work_email", email);
  params.set("min_likelihood", "6");

  const res = await fetch(`${PDL_BASE}/person/enrich?${params}`, {
    headers: { "X-Api-Key": key },
  });
  if (res.status === 404) return null; // not found is normal
  if (!res.ok) throw new Error(`PDL API error: ${res.status}`);
  const data = (await res.json()) as { data?: Record<string, unknown> };
  if (!data.data) return null;
  return mapPerson(data.data);
}

/**
 * Enrich a company by domain (or name). Useful for getting the canonical
 * domain to feed Hunter, or to surface industry/size for an org card.
 */
export async function enrichCompany(domain: string): Promise<PDLCompany | null> {
  const key = getKey();
  if (!key) throw new Error("PDL_API_KEY not configured");
  const params = new URLSearchParams();
  // PDL accepts either `website` or `name` — domain is more reliable.
  params.set("website", domain);

  const res = await fetch(`${PDL_BASE}/company/enrich?${params}`, {
    headers: { "X-Api-Key": key },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PDL API error: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!data) return null;
  const location = (data.location as Record<string, unknown> | undefined) ?? {};
  return {
    name: (data.display_name as string | undefined) ?? (data.name as string | undefined) ?? null,
    industry: (data.industry as string | undefined) ?? null,
    size: (data.size as string | undefined) ?? null,
    city: (location.locality as string | undefined) ?? null,
    state: (location.region as string | undefined) ?? null,
    linkedinUrl: (data.linkedin_url as string | undefined) ?? null,
    domain: (data.website as string | undefined) ?? (data.primary_domain as string | undefined) ?? null,
  };
}

/**
 * Normalize a company name for fuzzy comparison.
 *
 * Split on WHITESPACE only — internal punctuation ("&", "-", ".") is
 * stripped INSIDE the token so brand abbreviations stay intact:
 *   "J&E Bookkeeping"   → ["je", "bookkeeping"]
 *   "e-bookkeeping firm" → ["ebookkeeping", "firm"]
 *   "Acme Inc"          → ["acme"]   (inc is a stop word)
 *
 * Stop words are restricted to *corporate-form suffixes only* (LLC, Inc,
 * Corp, Co, Ltd…). Words like "firm/group/holdings/partners/associates"
 * carry meaning and DO distinguish entities — stripping them caused
 * "E-BOOKKEEPING" to falsely match "e-bookkeeping firm".
 */
function normCompanyTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length > 0 && !STOP_WORDS.has(t)),
  );
}
const STOP_WORDS = new Set([
  "the", "and", "of", "a", "an",
  "co", "company", "corp", "corporation",
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited",
]);

/**
 * Find people at a company. Returns up to 10 ranked by seniority signals.
 * Filters out results whose `job_company_name` doesn't share the dominant
 * token with the searched company — PDL's term-search is loose (token
 * overlap, not phrase match), so "J&E Bookkeeping" can match "e-bookkeeping
 * firm" without that filter.
 */
export async function searchPeopleAtCompany(company: string): Promise<PDLPerson[]> {
  const key = getKey();
  if (!key) throw new Error("PDL_API_KEY not configured");

  const body = {
    query: {
      bool: {
        must: [{ term: { job_company_name: company.toLowerCase() } }],
      },
    },
    size: 10,
  };

  const res = await fetch(`${PDL_BASE}/person/search`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`PDL API error: ${res.status}`);
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const all = (json.data ?? []).map(mapPerson);

  const wanted = normCompanyTokens(company);
  if (wanted.size === 0) return all;
  // Exact non-stop-word token-set equality. Tighter than overlap because
  // PDL's loose `term` search routinely surfaces generic-named companies
  // ("e-bookkeeping firm") that share one keyword with the searched name
  // but are different entities.
  return all.filter((p) => {
    if (!p.company) return false;
    const got = normCompanyTokens(p.company);
    if (got.size !== wanted.size) return false;
    for (const t of wanted) if (!got.has(t)) return false;
    return true;
  });
}

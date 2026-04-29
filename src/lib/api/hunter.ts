const HUNTER_BASE = "https://api.hunter.io/v2";

function getKey(): string {
  if (!process.env.HUNTER_API_KEY) {
    throw new Error("HUNTER_API_KEY not configured");
  }
  return process.env.HUNTER_API_KEY;
}

// Pass either {domain} or {company} — Hunter resolves the domain itself when
// you give it a company name, which is what we usually want (constructing
// `<companyname>.com` is wrong for most real businesses).
export async function findEmail(
  name: string,
  lookup: { domain?: string; company?: string },
): Promise<{
  email: string | null;
  score: number;
  sources: number;
}> {
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");

  const params = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    api_key: getKey(),
  });
  if (lookup.domain) params.set("domain", lookup.domain);
  else if (lookup.company) params.set("company", cleanCompany(lookup.company));
  else throw new Error("findEmail requires domain or company");

  const res = await fetch(`${HUNTER_BASE}/email-finder?${params}`);
  if (!res.ok) throw new Error(`Hunter API error: ${res.status}`);

  const data = await res.json();
  return {
    email: data.data?.email || null,
    score: data.data?.score || 0,
    sources: data.data?.sources || 0,
  };
}

export type HunterDomainEmail = {
  value: string;
  type: string; // "personal" | "generic"
  confidence: number;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
  phone_number: string | null;
};

// Hunter's company resolution dislikes punctuation. "Kisco, Senior Living"
// resolves to nothing; "Kisco Senior Living" resolves correctly. Strip
// commas / parens / extra whitespace before sending.
function cleanCompany(name: string): string {
  return name
    .replace(/[,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hunter's domain-search returns every known email at a company (up to 100).
// This is much richer than Apollo's people-search on free tiers — Hunter
// actually surfaces verified emails + titles + linkedin URLs directly.
export async function domainSearch(
  lookup: { domain?: string; company?: string },
  options: { limit?: number; onlyPersonal?: boolean } = {},
): Promise<{ domain: string | null; organization: string | null; emails: HunterDomainEmail[] }> {
  const params = new URLSearchParams({ api_key: getKey() });
  if (lookup.domain) params.set("domain", lookup.domain);
  else if (lookup.company) params.set("company", cleanCompany(lookup.company));
  else throw new Error("domainSearch requires domain or company");
  params.set("limit", String(options.limit ?? 25));
  if (options.onlyPersonal) params.set("type", "personal");

  const res = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
  if (!res.ok) throw new Error(`Hunter domain-search error: ${res.status}`);

  const data = await res.json();
  return {
    domain: data.data?.domain || null,
    organization: data.data?.organization || null,
    emails: (data.data?.emails || []) as HunterDomainEmail[],
  };
}

export async function verifyEmail(email: string): Promise<{
  status: string;
  score: number;
  result: string;
}> {
  const params = new URLSearchParams({
    email,
    api_key: getKey(),
  });

  const res = await fetch(`${HUNTER_BASE}/email-verifier?${params}`);
  if (!res.ok) throw new Error(`Hunter API error: ${res.status}`);

  const data = await res.json();
  return {
    status: data.data?.status || "unknown",
    score: data.data?.score || 0,
    result: data.data?.result || "unknown",
  };
}

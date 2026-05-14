/**
 * Apify integration for LinkedIn profile scraping.
 *
 * Uses the public actor `apify~linkedin-profile-scraper` (the
 * post-Proxycurl replacement after Proxycurl shut down July 2025).
 * Skipped silently if APIFY_API_KEY isn't configured.
 */
const APIFY_BASE = "https://api.apify.com/v2";

function getKey(): string | null {
  return process.env.APIFY_API_KEY ?? null;
}

export type ApifyLinkedInResult = {
  name: string | null;
  headline: string | null;
  currentRole: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  raw: Record<string, unknown>;
};

function mapProfile(raw: Record<string, unknown>): ApifyLinkedInResult {
  const exp = (raw.experience as Array<Record<string, unknown>> | undefined) ?? [];
  const current = exp[0] ?? {};
  return {
    name:
      (raw.fullName as string | undefined) ??
      (raw.name as string | undefined) ??
      [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() ??
      null,
    headline:
      (raw.headline as string | undefined) ??
      (raw.subTitle as string | undefined) ??
      null,
    currentRole:
      (current.title as string | undefined) ??
      (raw.position as string | undefined) ??
      (raw.jobTitle as string | undefined) ??
      null,
    company:
      (current.companyName as string | undefined) ??
      (raw.companyName as string | undefined) ??
      null,
    email: (raw.email as string | undefined) ?? null,
    phone: (raw.phone as string | undefined) ?? null,
    location:
      (raw.location as string | undefined) ??
      (raw.locationName as string | undefined) ??
      null,
    raw,
  };
}

export async function scrapeLinkedIn(
  profileUrl: string,
): Promise<ApifyLinkedInResult> {
  const key = getKey();
  if (!key) throw new Error("APIFY_API_KEY not configured");
  const res = await fetch(
    `${APIFY_BASE}/acts/apify~linkedin-profile-scraper/run-sync-get-dataset-items?token=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: profileUrl }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
  const data = await res.json();
  const raw = Array.isArray(data) && data.length > 0 ? data[0] : {};
  return mapProfile(raw);
}

/**
 * Find employees at a company via Apify's LinkedIn-company-employees actor.
 * The actor name is configurable via APIFY_COMPANY_ACTOR env var (default:
 * harvestapi~linkedin-company-employees, a well-known public actor).
 *
 * Times out at 30s via AbortController so a slow actor can't hang the
 * caller. Returns [] on any 4xx/5xx so the find-contacts pipeline keeps
 * moving when the actor isn't available or the company isn't on LinkedIn.
 */
export type ApifyCompanyEmployee = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
};

export async function scrapeCompanyEmployees(
  company: string,
  options: { limit?: number } = {},
): Promise<ApifyCompanyEmployee[]> {
  const key = getKey();
  if (!key) throw new Error("APIFY_API_KEY not configured");
  const actor = process.env.APIFY_COMPANY_ACTOR ?? "harvestapi~linkedin-company-employees";
  const limit = options.limit ?? 25;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: [company],
          companyName: company,
          maxItems: limit,
          maxResults: limit,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      throw new Error(`Apify ${actor} error: ${res.status}`);
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map((row): ApifyCompanyEmployee => {
      const fullName =
        (row.fullName as string | undefined) ??
        (row.name as string | undefined) ??
        [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
      return {
        name: fullName || "",
        title:
          (row.headline as string | undefined) ??
          (row.position as string | undefined) ??
          (row.jobTitle as string | undefined) ??
          (row.title as string | undefined) ??
          null,
        email: (row.email as string | undefined) ?? null,
        phone: (row.phone as string | undefined) ?? null,
        linkedinUrl:
          (row.url as string | undefined) ??
          (row.profileUrl as string | undefined) ??
          (row.linkedinUrl as string | undefined) ??
          null,
        location:
          (row.location as string | undefined) ??
          (row.locationName as string | undefined) ??
          null,
      };
    }).filter((p) => p.name.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

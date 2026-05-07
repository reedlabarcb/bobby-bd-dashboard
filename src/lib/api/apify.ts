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

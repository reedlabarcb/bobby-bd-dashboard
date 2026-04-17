const APIFY_BASE = "https://api.apify.com/v2";

function getKey(): string {
  if (!process.env.APIFY_API_KEY) {
    throw new Error("APIFY_API_KEY not configured");
  }
  return process.env.APIFY_API_KEY;
}

export async function scrapeLinkedIn(profileUrl: string): Promise<Record<string, unknown>> {
  // Use Apify's LinkedIn Profile Scraper actor
  const res = await fetch(
    `${APIFY_BASE}/acts/anchor~linkedin-profile-scraper/run-sync-get-dataset-items?token=${getKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: profileUrl }],
        proxyConfiguration: { useApifyProxy: true },
      }),
    }
  );

  if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : {};
}

export async function scrapeCompany(companyUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${APIFY_BASE}/acts/anchor~linkedin-company-scraper/run-sync-get-dataset-items?token=${getKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: companyUrl }],
        proxyConfiguration: { useApifyProxy: true },
      }),
    }
  );

  if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : {};
}

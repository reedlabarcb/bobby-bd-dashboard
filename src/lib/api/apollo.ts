const APOLLO_BASE = "https://api.apollo.io/v1";

function getKey(): string {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error("APOLLO_API_KEY not configured");
  }
  return process.env.APOLLO_API_KEY;
}

export async function enrichContact(email: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${APOLLO_BASE}/people/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": getKey(),
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) throw new Error(`Apollo API error: ${res.status}`);
  return res.json();
}

export async function searchPeople(query: {
  name?: string;
  company?: string;
  title?: string;
  city?: string;
}): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {
    per_page: 5,
  };
  if (query.name) {
    const parts = query.name.split(" ");
    params.person_name = query.name;
    if (parts.length >= 2) {
      params.first_name = parts[0];
      params.last_name = parts.slice(1).join(" ");
    }
  }
  if (query.company) params.organization_name = query.company;
  if (query.title) params.person_titles = [query.title];
  if (query.city) params.person_locations = [query.city];

  const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": getKey(),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) throw new Error(`Apollo API error: ${res.status}`);
  return res.json();
}

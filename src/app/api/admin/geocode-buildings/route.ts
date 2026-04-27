import { db } from "@/lib/db";
import { buildings } from "@/lib/db/schema";
import { eq, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Walks every building with NULL lat/lng, calls the US Census Bureau geocoder
// (free, no signup, US-only, ~10 req/sec polite limit), and writes coordinates.
//
// Idempotent: skips rows that already have coordinates. Safe to re-run after
// adding more buildings via imports.

// Census treats some North County SD neighborhoods as parts of the parent city
// rather than cities of their own. Try the literal city first, then a fallback.
const CITY_FALLBACK: Record<string, string> = {
  "Rancho Bernardo": "San Diego",
  "Sabre Springs": "San Diego",
  "Carmel Valley": "San Diego",
  "Sorrento Valley": "San Diego",
  "La Jolla": "San Diego",
  "Mira Mesa": "San Diego",
  "Scripps Ranch": "San Diego",
  "Del Mar Heights": "Del Mar",
};

async function geocodeAttempt(
  address: string,
  city: string,
  state: string
): Promise<{ lat: number; lng: number } | null> {
  const query = encodeURIComponent(`${address}, ${city}, ${state}`);
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${query}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const match = data.result?.addressMatches?.[0];
    if (match?.coordinates?.x != null && match?.coordinates?.y != null) {
      return { lat: match.coordinates.y, lng: match.coordinates.x };
    }
    return null;
  } catch {
    return null;
  }
}

// Strip building-name suffixes that some addresses pick up during ingest
// (e.g. "235 5th Avenue Corporate Center" → "235 5th Avenue"). Heuristic but
// cheap.
function stripBuildingSuffix(address: string): string | null {
  const cleaned = address.replace(
    /\s+(Corporate Center|Corp Center|Centre|Office Park|Business Park|Plaza|Tower|Building)\s*$/i,
    ""
  );
  return cleaned !== address ? cleaned : null;
}

async function geocodeOnce(
  address: string,
  city: string,
  state: string
): Promise<{ lat: number; lng: number } | null> {
  // 1. literal address + city
  let coords = await geocodeAttempt(address, city, state);
  if (coords) return coords;

  // 2. fallback city (Rancho Bernardo → San Diego, etc.)
  const fallbackCity = CITY_FALLBACK[city];
  if (fallbackCity) {
    coords = await geocodeAttempt(address, fallbackCity, state);
    if (coords) return coords;
  }

  // 3. strip building-name suffix and retry both city forms
  const stripped = stripBuildingSuffix(address);
  if (stripped) {
    coords = await geocodeAttempt(stripped, city, state);
    if (coords) return coords;
    if (fallbackCity) {
      coords = await geocodeAttempt(stripped, fallbackCity, state);
      if (coords) return coords;
    }
  }

  return null;
}

const CONCURRENCY = 6; // Census handles small bursts comfortably; 6 = ~280 calls in ~50s
const DELAY_MS = 50;

export async function POST(request: Request) {
  const serverSecret = process.env.UPLOAD_SECRET;
  if (serverSecret) {
    const headerSecret = request.headers.get("x-upload-secret");
    if (!headerSecret || headerSecret !== serverSecret) {
      return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
    }
  }

  // Optional ?limit=N for testing without burning through everything.
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(1000, parseInt(limitParam, 10))) : 1000;

  const targets = db
    .select({
      id: buildings.id,
      address: buildings.address,
      city: buildings.city,
      state: buildings.state,
    })
    .from(buildings)
    .where(or(isNull(buildings.lat), isNull(buildings.lng)))
    .limit(limit)
    .all();

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, geocoded: 0, missed: 0, remaining: 0 });
  }

  let geocoded = 0;
  let missed = 0;

  // Worker pool: kick off CONCURRENCY workers that share a single index.
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= targets.length) return;
      const t = targets[i];
      const coords = await geocodeOnce(t.address, t.city ?? "", t.state ?? "CA");
      if (coords) {
        db.update(buildings)
          .set({ lat: coords.lat, lng: coords.lng })
          .where(eq(buildings.id, t.id))
          .run();
        geocoded++;
      } else {
        missed++;
      }
      // Polite spacing — Census tolerates higher but no need to push it.
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // How many still need a coord after this run.
  const remaining = Number(
    db
      .select({ c: sql<number>`count(*)` })
      .from(buildings)
      .where(or(isNull(buildings.lat), isNull(buildings.lng)))
      .get()?.c ?? 0
  );

  return NextResponse.json({ ok: true, geocoded, missed, remaining, processed: targets.length });
}

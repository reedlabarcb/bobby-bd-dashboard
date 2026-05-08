/**
 * Derive a Building Type label — one of "medical" | "office" | "industrial" —
 * from whatever signal exists in the DB.
 *
 * Signal hierarchy (highest priority first):
 *   1. buildings.property_subtype (most explicit — "Medical Office",
 *      "General Office", "Light Manufacturing", etc.)
 *   2. buildings.name        (e.g. "...Medical Center", "...Industrial Park")
 *   3. Tenant industries     (Health Care / Life Science / Medical Device →
 *                             medical; Manufacturing / Construction → industrial)
 *   4. Lease.property_type   (string field already on leases — "office" etc.)
 *   5. Default               → "office"  (it's the dominant CRE asset class
 *                             in this dataset; avoids dropping a NULL badge
 *                             on every building with no signal at all)
 *
 * The function is pure: takes plain objects, no DB access. Compute in the
 * page-level server component once and pass it down to the client table.
 */

export type BuildingType = "medical" | "office" | "industrial";

const MEDICAL_SUBTYPES = ["medical office", "medical clinic", "medical", "life science", "lab"];
const INDUSTRIAL_SUBTYPES = ["industrial", "manufacturing", "warehouse", "r&d", "r & d", "flex", "distribution"];
const OFFICE_SUBTYPES = ["general office", "office", "professional", "creative office"];

const MEDICAL_INDUSTRIES = [
  "health", "healthcare", "medical", "clinic", "dental", "pharma",
  "biotech", "life science", "medical device", "hospital",
];
const INDUSTRIAL_INDUSTRIES = [
  "manufactur", "warehouse", "distribution", "logistics",
  "construction", "industrial",
];

const MEDICAL_NAME_HINTS = ["medical", "clinic", "hospital", "health center", "pavilion", "wellness"];
const INDUSTRIAL_NAME_HINTS = ["industrial", "warehouse", "manufactur", "logistics", "distribution", "business park"];

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function matches(haystack: string, needles: string[]): boolean {
  if (!haystack) return false;
  return needles.some((n) => haystack.includes(n));
}

export function deriveBuildingType(args: {
  propertySubtype?: string | null;
  name?: string | null;
  // Aggregated tenant signal — pass any tenant industries on this building
  tenantIndustries?: (string | null)[];
  // Lease property_type values for leases at this building
  leasePropertyTypes?: (string | null)[];
}): BuildingType {
  // 1. property_subtype — most explicit
  const sub = lower(args.propertySubtype);
  if (sub) {
    if (matches(sub, MEDICAL_SUBTYPES)) return "medical";
    if (matches(sub, INDUSTRIAL_SUBTYPES)) return "industrial";
    if (matches(sub, OFFICE_SUBTYPES)) return "office";
    // Fall through if subtype is something unrecognised (e.g. "Strip/In-Line Center")
  }

  // 2. building name keywords
  const name = lower(args.name);
  if (name) {
    if (matches(name, MEDICAL_NAME_HINTS)) return "medical";
    if (matches(name, INDUSTRIAL_NAME_HINTS)) return "industrial";
  }

  // 3. tenant industries — count which category dominates
  const industries = (args.tenantIndustries ?? []).map(lower).filter(Boolean);
  if (industries.length > 0) {
    let med = 0, ind = 0;
    for (const i of industries) {
      if (matches(i, MEDICAL_INDUSTRIES)) med++;
      else if (matches(i, INDUSTRIAL_INDUSTRIES)) ind++;
    }
    // "Dominant" = at least 50% of tenants in that category, with a min of 1.
    if (med >= ind && med >= Math.max(1, Math.ceil(industries.length / 2))) return "medical";
    if (ind > med && ind >= Math.max(1, Math.ceil(industries.length / 2))) return "industrial";
  }

  // 4. lease.property_type — last numerical signal
  const leaseTypes = (args.leasePropertyTypes ?? []).map(lower).filter(Boolean);
  if (leaseTypes.length > 0) {
    let med = 0, ind = 0, off = 0;
    for (const t of leaseTypes) {
      if (matches(t, ["medical", "life science", "lab"])) med++;
      else if (matches(t, ["industrial", "warehouse", "manufactur"])) ind++;
      else if (matches(t, ["office"])) off++;
    }
    if (med > ind && med > off) return "medical";
    if (ind > med && ind > off) return "industrial";
    if (off > 0) return "office";
  }

  // 5. default to office (dominant CRE asset class in this dataset)
  return "office";
}

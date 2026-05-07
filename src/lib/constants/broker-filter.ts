/**
 * Single source of truth for filtering brokers/brokerages out of the
 * pipeline. Used by the cleanup script, every import path, every
 * enrichment/find-people route, and the manual-add form.
 *
 * Keep all matching case-insensitive. Word-boundary matching prevents
 * false positives like "REIT" matching "real estate" — see helpers
 * below for the actual matcher.
 */

export const BROKER_TITLE_KEYWORDS: string[] = [
  "broker",
  "brokerage",
  "realtor",
  "real estate agent",
  "leasing agent",
  "tenant rep",
  "landlord rep",
  "investment sales",
  "capital markets",
  "cre advisor",
  "commercial real estate",
  "listing agent",
  "associate broker",
  "managing broker",
  "senior broker",
  "vice president investments",
  "director investments",
];

export const BROKER_COMPANY_KEYWORDS: string[] = [
  "cbre",
  "jll",
  "cushman & wakefield",
  "cushman wakefield",
  "colliers",
  "newmark",
  "savills",
  "marcus & millichap",
  "marcus millichap",
  "kidder mathews",
  "lee & associates",
  "lee associates",
  "nai",
  "avison young",
  "svn",
  "transwestern",
  "eastdil",
  "hff",
  "walker & dunlop",
  "walker dunlop",
  "berkadia",
  "meridian",
  "cbre|gws",
  "cbre gws",
  "jones lang lasalle",
  "dtz",
  "cassidy turley",
  "sperry van ness",
  "grubb & ellis",
  "grubb ellis",
  "cb richard ellis",
];

/**
 * Returns true if the given string contains any of the keywords.
 * Match is case-insensitive and uses substring matching, except for
 * the standalone "nai" token (very short, would over-match) which is
 * checked with word boundaries.
 */
export function matchesKeyword(value: string | null | undefined, keywords: string[]): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    // Tokens 2 chars or shorter need word-boundary match; longer can substring.
    if (k.length <= 3) {
      const re = new RegExp(`(^|\\b|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$|[^a-z0-9])`, "i");
      if (re.test(value)) return kw;
    } else {
      if (v.includes(k)) return kw;
    }
  }
  return null;
}

/**
 * One-stop check: does any of the contact's signal fields look like a
 * broker? Returns the matched-keyword reason (for diagnostics) or null
 * if the contact is clean.
 */
export function brokerReason(args: {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  type?: string | null;
}): string | null {
  if (args.type && args.type.toLowerCase() === "broker") return "type=broker";
  const tHit = matchesKeyword(args.title, BROKER_TITLE_KEYWORDS);
  if (tHit) return `title matches "${tHit}"`;
  const cHit = matchesKeyword(args.company, BROKER_COMPANY_KEYWORDS);
  if (cHit) return `company matches "${cHit}"`;
  // Sometimes the row has no title and the company is in the `name` field
  // (LLC-shaped imports). Check the name against company keywords too.
  const nHit = matchesKeyword(args.name, BROKER_COMPANY_KEYWORDS);
  if (nHit) return `name matches brokerage "${nHit}"`;
  return null;
}

export function isBroker(args: {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  type?: string | null;
}): boolean {
  return brokerReason(args) !== null;
}

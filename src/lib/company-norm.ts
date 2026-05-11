/**
 * Canonical-key normalization for company names.
 *
 * Two companies are considered the same entity iff `companyKey(a) ===
 * companyKey(b)`. Used wherever we need to merge duplicates that differ
 * only in corporate-form suffix, punctuation, or whitespace:
 *
 *   "Jensen Hughes"         → "hughes|jensen"
 *   "Jensen Hughes Inc."    → "hughes|jensen"  (inc stripped)
 *   "Jensen Hughes, Inc"    → "hughes|jensen"  (comma + inc stripped)
 *   "J&E Bookkeeping"       → "bookkeeping|je"
 *   "J&E Bookkeeping LLC"   → "bookkeeping|je"
 *   "Acme Corp"             → "acme"
 *   "Acme Inc"              → "acme"
 *
 * Tokens are sorted so order doesn't matter; stop-word list is the
 * corporate-form suffixes only (LLC, Inc, Corp, Co, Ltd, etc.). Words
 * like "firm/group/holdings/partners/associates" carry meaning and are
 * NOT stripped — they really do distinguish brands.
 *
 * Split on whitespace only; internal punctuation ("&", "-", ".") is
 * stripped INSIDE the token so brand abbreviations stay intact
 * ("J&E" → "je", not "j" + "e").
 */

const STOP_WORDS = new Set([
  "the", "and", "of", "a", "an",
  "co", "company", "corp", "corporation",
  "inc", "incorporated",
  "llc", "llp", "lp", "ltd", "limited",
]);

export function companyTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

export function companyKey(name: string | null | undefined): string {
  const toks = companyTokens(name);
  if (toks.length === 0) return "";
  return [...toks].sort().join("|");
}

/**
 * Heuristic: from a list of variant spellings of the same company,
 * pick the canonical one for display. Prefers names with proper
 * casing and a corporate suffix when one is available.
 */
export function pickDisplayName(variants: string[]): string {
  if (variants.length === 0) return "";
  // 1. Names with corp suffixes are usually more "official" looking.
  const suffixed = variants.filter((v) =>
    /\b(Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|LLP|LP)\b/i.test(v),
  );
  if (suffixed.length > 0) {
    // pick the longest among suffixed (more complete)
    return suffixed.sort((a, b) => b.length - a.length)[0];
  }
  // 2. Otherwise: prefer the variant that's NOT ALL CAPS (proper casing)
  const properCased = variants.filter((v) => v !== v.toUpperCase());
  if (properCased.length > 0) {
    return properCased.sort((a, b) => b.length - a.length)[0];
  }
  // 3. Fallback: longest variant
  return [...variants].sort((a, b) => b.length - a.length)[0];
}

/**
 * Email-pattern detection and projection.
 *
 * Given a person's name and a confirmed email at the same company,
 * detect the local-part pattern (e.g. "first.last", "flast", "first").
 * Then apply that pattern to a different person's name to predict
 * their email at the same domain.
 *
 * Used by the Deep Search routes — when we can't find a person's
 * email but we already have one or more confirmed emails at the same
 * company, we infer the missing one and verify with Hunter.
 */

export type EmailPattern =
  | "first.last"
  | "first_last"
  | "first-last"
  | "firstlast"
  | "flast"
  | "f.last"
  | "first"
  | "last"
  | "last.first"
  | "lastfirst"
  | "lastf";

const PATTERN_BUILDERS: Record<EmailPattern, (first: string, last: string) => string> = {
  "first.last":  (f, l) => `${f}.${l}`,
  "first_last":  (f, l) => `${f}_${l}`,
  "first-last":  (f, l) => `${f}-${l}`,
  "firstlast":   (f, l) => `${f}${l}`,
  "flast":       (f, l) => `${f[0] ?? ""}${l}`,
  "f.last":      (f, l) => `${f[0] ?? ""}.${l}`,
  "first":       (f) => f,
  "last":        (_, l) => l,
  "last.first":  (f, l) => `${l}.${f}`,
  "lastfirst":   (f, l) => `${l}${f}`,
  "lastf":       (f, l) => `${l}${f[0] ?? ""}`,
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Split a person name into first/last tokens. Handles "Last, First"
 * commas, multi-token names ("Mary Jane Smith" → first="mary", last="smith"),
 * and middle-initial style ("John Q. Public" → first="john", last="public").
 */
export function splitName(fullName: string): { first: string; last: string } | null {
  if (!fullName) return null;
  let raw = fullName.trim();
  if (raw.includes(",")) {
    const [last, first] = raw.split(",").map((s) => s.trim());
    if (!last || !first) return null;
    return { first: normalize(first.split(/\s+/)[0]), last: normalize(last) };
  }
  raw = raw.replace(/[.]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = raw.split(" ").filter((t) => t.length > 1); // drop single-letter middle initials
  if (tokens.length < 2) return null;
  return { first: normalize(tokens[0]), last: normalize(tokens[tokens.length - 1]) };
}

/**
 * Given a name and a known email at the same company, return the pattern
 * (if recognizable) plus the local-part. Returns null if name+email
 * don't match any known pattern.
 */
export function detectPattern(
  fullName: string,
  email: string,
): { pattern: EmailPattern; domain: string } | null {
  const split = splitName(fullName);
  if (!split) return null;
  const { first, last } = split;
  if (!first || !last) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const local = normalize(email.slice(0, at));
  const domain = email.slice(at + 1).toLowerCase();
  for (const [name, build] of Object.entries(PATTERN_BUILDERS) as [
    EmailPattern,
    (typeof PATTERN_BUILDERS)[EmailPattern],
  ][]) {
    if (normalize(build(first, last)) === local) {
      return { pattern: name, domain };
    }
  }
  return null;
}

/**
 * Apply a detected pattern to a different person's name to predict
 * their email at the same domain.
 */
export function applyPattern(
  pattern: EmailPattern,
  fullName: string,
  domain: string,
): string | null {
  const split = splitName(fullName);
  if (!split) return null;
  const { first, last } = split;
  if (!first || !last) return null;
  const local = PATTERN_BUILDERS[pattern](first, last);
  if (!local) return null;
  return `${local}@${domain}`;
}

/**
 * Choose the most-frequent pattern from a list of (name, email) pairs
 * at the same company. Returns null if no pair yields a recognizable
 * pattern, or if all pairs disagree (no clear majority).
 */
export function chooseMajorityPattern(
  knownContacts: Array<{ name: string; email: string }>,
): { pattern: EmailPattern; domain: string; supportCount: number } | null {
  if (knownContacts.length === 0) return null;
  const counts = new Map<string, { pattern: EmailPattern; domain: string; n: number }>();
  for (const c of knownContacts) {
    const det = detectPattern(c.name, c.email);
    if (!det) continue;
    const key = `${det.pattern}|${det.domain}`;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { ...det, n: 1 });
  }
  if (counts.size === 0) return null;
  let best: { pattern: EmailPattern; domain: string; n: number } | null = null;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  if (!best) return null;
  return { pattern: best.pattern, domain: best.domain, supportCount: best.n };
}

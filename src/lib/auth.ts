import crypto from "node:crypto";

// Single-user shared-password auth. Cookie value carries an expiration
// timestamp + HMAC; verification is stateless (no session table required).
//
// Why not random session IDs:
//   - this app has one user (Bobby). A session table for one user is overkill.
//   - HMAC verification is stateless, survives Railway redeploys, and works
//     across the SQLite volume mount without any schema change.

export const SESSION_COOKIE = "bbd_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string | null {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD && getSecret());
}

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function signSessionCookie(): { value: string; expiresAt: number } {
  const secret = getSecret();
  if (!secret) throw new Error("AUTH_SECRET not configured");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const sig = hmac(secret, String(expiresAt));
  return { value: `${expiresAt}.${sig}`, expiresAt };
}

export function verifySessionCookie(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const secret = getSecret();
  if (!secret) return false;
  const dot = raw.indexOf(".");
  if (dot < 0) return false;
  const expiresAtStr = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = hmac(secret, expiresAtStr);
  // Constant-time compare; HMAC outputs are equal-length hex.
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// Compare a submitted password to APP_PASSWORD in constant time.
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  if (submitted.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
}

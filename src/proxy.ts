import { NextRequest, NextResponse } from "next/server";
import { isAuthEnabled, verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";

// Paths that bypass auth entirely:
//   /login, /api/login, /api/logout — the auth flow itself
//   /api/process-document        — Box-Drive watcher uses its own UPLOAD_SECRET
//   /_next/*, /favicon.ico, public assets — handled before proxy in dev
//                                          but list them defensively
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/api/logout",
  "/api/process-document",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/static/")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  // If APP_PASSWORD or AUTH_SECRET aren't configured, auth is disabled and
  // the app stays wide open (current behavior). Surfaced once in server logs
  // on first request via the warning below.
  if (!isAuthEnabled()) {
    if (!globalThis.__bbd_auth_warned) {
      globalThis.__bbd_auth_warned = true;
      console.warn(
        "[auth] APP_PASSWORD and/or AUTH_SECRET not set — site is publicly accessible"
      );
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionCookie(cookie)) return NextResponse.next();

  // API requests get 401 JSON; pages get a redirect to /login with a return path.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every request except built-in next assets — checked again in proxy().
  matcher: ["/((?!_next/static|_next/image).*)"],
};

declare global {
  var __bbd_auth_warned: boolean | undefined;
}

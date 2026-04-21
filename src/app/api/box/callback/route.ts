import { db } from "@/lib/db";
import { boxConfig } from "@/lib/db/schema";
import { exchangeCodeForTokens } from "@/lib/api/box";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/library?error=no_code", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    // Upsert box config (only keep one row)
    const existing = db.select().from(boxConfig).get();
    if (existing) {
      db.update(boxConfig)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt,
        })
        .run();
    } else {
      db.insert(boxConfig).values({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
      }).run();
    }

    return NextResponse.redirect(new URL("/library?connected=true", request.url));
  } catch (error) {
    console.error("Box OAuth error:", error);
    return NextResponse.redirect(new URL(`/library?error=${encodeURIComponent(error instanceof Error ? error.message : "auth_failed")}`, request.url));
  }
}

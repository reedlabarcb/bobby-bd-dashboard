import { db } from "@/lib/db";
import { boxConfig } from "@/lib/db/schema";
import { getBoxAuthUrl, refreshAccessToken } from "@/lib/api/box";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const config = db.select().from(boxConfig).get();

    if (!config?.accessToken) {
      let authUrl: string | null = null;
      try {
        authUrl = getBoxAuthUrl();
      } catch {
        // BOX_CLIENT_ID not configured
      }
      return NextResponse.json({ connected: false, authUrl });
    }

    // Check if token is expired
    if (config.expiresAt && new Date(config.expiresAt) < new Date()) {
      try {
        const tokens = await refreshAccessToken(config.refreshToken!);
        db.update(boxConfig)
          .set({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
          })
          .run();
        return NextResponse.json({ connected: true, lastSync: config.lastSyncAt });
      } catch {
        return NextResponse.json({ connected: false, authUrl: getBoxAuthUrl(), error: "Token expired" });
      }
    }

    return NextResponse.json({
      connected: true,
      lastSync: config.lastSyncAt,
      watchedFolders: config.watchedFolders ? JSON.parse(config.watchedFolders) : [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check Box status" },
      { status: 500 }
    );
  }
}

import { db } from "@/lib/db";
import { boxConfig } from "@/lib/db/schema";
import { listFolder, getFolderInfo, refreshAccessToken } from "@/lib/api/box";
import { NextResponse } from "next/server";

async function getValidToken(): Promise<string> {
  const config = db.select().from(boxConfig).get();
  if (!config?.accessToken) throw new Error("Box not connected");

  if (config.expiresAt && new Date(config.expiresAt) < new Date()) {
    const tokens = await refreshAccessToken(config.refreshToken!);
    db.update(boxConfig)
      .set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      })
      .run();
    return tokens.accessToken;
  }

  return config.accessToken;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId") || "0";

    const token = await getValidToken();
    const [folder, contents] = await Promise.all([
      getFolderInfo(token, folderId),
      listFolder(token, folderId),
    ]);

    return NextResponse.json({ folder, items: contents.items, totalCount: contents.totalCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list folder" },
      { status: 500 }
    );
  }
}

// POST — save a folder as a watched folder
export async function POST(request: Request) {
  try {
    const { folderId } = await request.json();
    const config = db.select().from(boxConfig).get();
    if (!config) throw new Error("Box not connected");

    const current = config.watchedFolders ? JSON.parse(config.watchedFolders) : [];
    if (!current.includes(folderId)) {
      current.push(folderId);
      db.update(boxConfig)
        .set({ watchedFolders: JSON.stringify(current) })
        .run();
    }

    return NextResponse.json({ watchedFolders: current });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to watch folder" },
      { status: 500 }
    );
  }
}

import { db } from "@/lib/db";
import { boxConfig, documents } from "@/lib/db/schema";
import { listFolder, downloadFile, refreshAccessToken, getFolderInfo } from "@/lib/api/box";
import { processDocument } from "@/lib/api/document-processor";
import { eq } from "drizzle-orm";
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

const SUPPORTED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".docx"];

function isSupportedFile(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

export async function POST(request: Request) {
  try {
    const { folderId } = await request.json();
    const token = await getValidToken();

    const folderInfo = await getFolderInfo(token, folderId);

    // Get all files in folder (paginate)
    let offset = 0;
    const allFiles: Array<{ id: string; name: string; size?: number; modified_at?: string }> = [];

    while (true) {
      const result = await listFolder(token, folderId, offset, 100);
      const files = result.items.filter(
        item => item.type === "file" && isSupportedFile(item.name)
      );
      allFiles.push(...files);
      offset += 100;
      if (offset >= result.totalCount) break;
    }

    let newDocs = 0;
    let processed = 0;
    const errors: string[] = [];

    for (const file of allFiles) {
      // Skip if already indexed
      const existing = db.select().from(documents)
        .where(eq(documents.boxFileId, file.id))
        .get();

      if (existing) continue;

      // Create document record
      const fileType = file.name.split(".").pop()?.toLowerCase() || "unknown";
      const doc = db.insert(documents).values({
        boxFileId: file.id,
        filename: file.name,
        fileType,
        boxFolderId: folderId,
        boxFolderPath: folderInfo.path,
        fileSize: file.size,
        boxModifiedAt: file.modified_at,
        status: "pending",
      }).returning().get();

      newDocs++;

      // Process PDFs immediately (Excel/Word support later)
      if (fileType === "pdf" && process.env.ANTHROPIC_API_KEY) {
        try {
          const buffer = await downloadFile(token, file.id);
          const base64 = buffer.toString("base64");
          await processDocument(doc.id, base64);
          processed++;
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
    }

    // Update last sync time
    db.update(boxConfig)
      .set({ lastSyncAt: new Date().toISOString().replace("T", " ").split(".")[0] })
      .run();

    return NextResponse.json({
      totalFiles: allFiles.length,
      newDocuments: newDocs,
      processed,
      errors,
      folderPath: folderInfo.path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { upsertContact, countTable } from "@/lib/import-helpers";
import { contacts } from "@/lib/db/schema";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const action = formData.get("action") as string;
    const mapping = formData.get("mapping") as string;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    if (action === "preview" || !mapping) {
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      const preview = data.slice(0, 5);
      return NextResponse.json({ columns, preview, totalRows: data.length });
    }

    const columnMap: Record<string, string> = JSON.parse(mapping);

    const upload = db.insert(uploads).values({
      filename: file.name,
      fileType: "excel",
      status: "processing",
    }).returning().get();

    const before = countTable(contacts);
    let processed = 0;

    for (const row of data) {
      const mapped: Record<string, unknown> = {};
      for (const [contactField, excelColumn] of Object.entries(columnMap)) {
        if (excelColumn && row[excelColumn] !== undefined) {
          mapped[contactField] = String(row[excelColumn]);
        }
      }

      if (mapped.name) {
        upsertContact(
          {
            name: mapped.name as string,
            email: (mapped.email as string) || null,
            phone: (mapped.phone as string) || null,
            company: (mapped.company as string) || null,
            title: (mapped.title as string) || null,
            type: (mapped.type as "buyer" | "seller" | "broker" | "lender" | "landlord" | "other") || "other",
            notes: (mapped.notes as string) || null,
          },
          { sourceFile: file.name }
        );
        processed++;
      }
    }

    const created = countTable(contacts) - before;
    const updated = processed - created;

    db.update(uploads)
      .set({ status: "done", recordsCreated: created })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({ imported: processed, created, updated, total: data.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

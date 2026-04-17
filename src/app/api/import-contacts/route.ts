import { db } from "@/lib/db";
import { contacts, uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

// Step 1: Preview — parse Excel and return columns + sample data
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const action = formData.get("action") as string; // "preview" or "import"
    const mapping = formData.get("mapping") as string; // JSON mapping for import

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    if (action === "preview" || !mapping) {
      // Return column names and first 5 rows for mapping UI
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      const preview = data.slice(0, 5);
      return NextResponse.json({ columns, preview, totalRows: data.length });
    }

    // Step 2: Import with mapping
    const columnMap: Record<string, string> = JSON.parse(mapping);

    // Create upload record
    const upload = db.insert(uploads).values({
      filename: file.name,
      fileType: "excel",
      status: "processing",
    }).returning().get();

    let created = 0;
    for (const row of data) {
      const mapped: Record<string, unknown> = {};
      for (const [contactField, excelColumn] of Object.entries(columnMap)) {
        if (excelColumn && row[excelColumn] !== undefined) {
          mapped[contactField] = String(row[excelColumn]);
        }
      }

      if (mapped.name) {
        db.insert(contacts).values({
          name: mapped.name as string,
          email: (mapped.email as string) || null,
          phone: (mapped.phone as string) || null,
          company: (mapped.company as string) || null,
          title: (mapped.title as string) || null,
          type: (mapped.type as "buyer" | "seller" | "broker" | "lender" | "other") || "other",
          source: `Import: ${file.name}`,
          city: (mapped.city as string) || null,
          state: (mapped.state as string) || null,
          notes: (mapped.notes as string) || null,
        }).run();
        created++;
      }
    }

    // Update upload
    db.update(uploads)
      .set({ status: "done", recordsCreated: created })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({ imported: created, total: data.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

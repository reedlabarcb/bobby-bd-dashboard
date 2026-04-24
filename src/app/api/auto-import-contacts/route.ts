import { db } from "@/lib/db";
import { contacts, uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

// Heuristic column-name matcher. Returns the first matching source column for
// each target field, or undefined.
function autoMapColumns(columns: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const take = (field: string, matchers: RegExp[]) => {
    if (map[field]) return;
    for (const col of columns) {
      const lower = col.toLowerCase().trim();
      if (matchers.some((re) => re.test(lower))) {
        map[field] = col;
        return;
      }
    }
  };

  take("name", [/\bname\b/, /\bfull name\b/, /\bcontact( name)?\b/, /\bperson\b/]);
  take("email", [/\bemail\b/, /\be-?mail\b/]);
  take("phone", [/\bphone\b/, /\bmobile\b/, /\bcell\b/, /\btel\b/, /\btelephone\b/]);
  take("company", [/\bcompany\b/, /\bfirm\b/, /\borganization\b/, /\borg\b/, /\bemployer\b/, /\baccount\b/]);
  take("title", [/\btitle\b/, /\brole\b/, /\bposition\b/, /\bjob\b/]);
  take("city", [/\bcity\b/, /\btown\b/]);
  take("state", [/\bstate\b/, /\bprovince\b/, /\bregion\b/]);
  take("notes", [/\bnotes?\b/, /\bcomments?\b/, /\bremarks?\b/, /\bdescription\b/]);

  return map;
}

const ALLOWED_TYPES = new Set(["buyer", "seller", "broker", "lender", "other"]);
type ContactType = "buyer" | "seller" | "broker" | "lender" | "other";

export async function POST(request: Request) {
  try {
    // Shared-secret auth when UPLOAD_SECRET is set (matches /api/process-document).
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const headerSecret = request.headers.get("x-upload-secret");
      if (headerSecret && headerSecret !== serverSecret) {
        return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    if (rows.length === 0) {
      return NextResponse.json({ imported: 0, updated: 0, skipped: 0, mapping: {} });
    }

    const columns = Object.keys(rows[0]);
    const mapping = autoMapColumns(columns);

    if (!mapping.name) {
      return NextResponse.json(
        {
          error:
            "Could not find a Name column. Expected one of: Name, Full Name, Contact, Person. " +
            "Available columns: " +
            columns.join(", "),
          columns,
        },
        { status: 400 }
      );
    }

    const upload = db
      .insert(uploads)
      .values({
        filename: file.name,
        fileType: "excel",
        status: "processing",
      })
      .returning()
      .get();

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const get = (field: string) => {
        const col = mapping[field];
        const v = col ? row[col] : undefined;
        if (v === undefined || v === null || v === "") return null;
        return String(v).trim();
      };

      const name = get("name");
      if (!name) {
        skipped++;
        continue;
      }

      const email = get("email");
      const company = get("company");
      const typeRaw = (get("title") || "").toLowerCase();
      const type: ContactType = ALLOWED_TYPES.has(typeRaw)
        ? (typeRaw as ContactType)
        : "other";

      const fields = {
        name,
        email: email ?? null,
        phone: get("phone"),
        company: company ?? null,
        title: get("title"),
        type,
        source: `Watcher: ${file.name}`,
        city: get("city"),
        state: get("state"),
        notes: get("notes"),
      };

      // Upsert: prefer email match, fall back to (name, company) pair.
      let existing = null as typeof contacts.$inferSelect | null;
      if (email) {
        existing =
          db.select().from(contacts).where(eq(contacts.email, email)).get() ?? null;
      }
      if (!existing && company) {
        const byNameCompany = db
          .select()
          .from(contacts)
          .where(eq(contacts.name, name))
          .all()
          .find((c) => c.company === company);
        existing = byNameCompany ?? null;
      }

      if (existing) {
        db.update(contacts)
          .set({
            ...fields,
            updatedAt: new Date().toISOString().replace("T", " ").split(".")[0],
          })
          .where(eq(contacts.id, existing.id))
          .run();
        updated++;
      } else {
        db.insert(contacts).values(fields).run();
        imported++;
      }
    }

    db.update(uploads)
      .set({ status: "done", recordsCreated: imported + updated })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({
      imported,
      updated,
      skipped,
      total: rows.length,
      mapping,
      filename: file.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Auto-import failed" },
      { status: 500 }
    );
  }
}

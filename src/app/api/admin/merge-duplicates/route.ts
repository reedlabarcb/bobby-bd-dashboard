import { getSqliteRaw } from "@/lib/db";
import { NextResponse } from "next/server";

const ONE_TIME_TOKEN = "merge-run-2026-05-06";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== ONE_TIME_TOKEN) {
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const auth = request.headers.get("x-upload-secret");
      if (auth !== serverSecret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }
  }

  const db = getSqliteRaw();

  const run = db.transaction(() => {
    let deleted = 0;
    let merged = 0;

    // 1. Delete junk rows not referenced by any FK
    const junk = db.prepare(`
      DELETE FROM contacts
      WHERE lower(trim(name)) IN ('none','self-represented','')
        AND id NOT IN (SELECT contact_id FROM activities WHERE contact_id IS NOT NULL)
        AND id NOT IN (SELECT contact_id FROM contact_enrichments WHERE contact_id IS NOT NULL)
        AND id NOT IN (SELECT landlord_contact_id FROM buildings WHERE landlord_contact_id IS NOT NULL)
    `).run();
    deleted += junk.changes;

    // 2. Find duplicate name groups
    const groups = db.prepare(`
      SELECT lower(trim(name)) as key
      FROM contacts
      WHERE name IS NOT NULL AND name != ''
      GROUP BY lower(trim(name))
      HAVING count(*) > 1
    `).all() as { key: string }[];

    for (const { key } of groups) {
      const rows = db.prepare(`
        SELECT * FROM contacts WHERE lower(trim(name)) = ?
        ORDER BY (
          CASE WHEN email IS NOT NULL AND email != '' THEN 10 ELSE 0 END +
          CASE WHEN phone IS NOT NULL AND phone != '' THEN 5 ELSE 0 END +
          CASE WHEN company IS NOT NULL AND company != '' THEN 3 ELSE 0 END +
          CASE WHEN title IS NOT NULL AND title != '' THEN 2 ELSE 0 END
        ) DESC, id ASC
      `).all(key) as Record<string, string | number | null>[];

      if (rows.length < 2) continue;

      const keeper = { ...rows[0] };
      const rest = rows.slice(1);
      const patch: Record<string, string> = {};
      const fields = ["email","phone","direct_phone","mobile_phone","company","title","city","state","notes"];

      for (const dup of rest) {
        for (const f of fields) {
          if (!keeper[f] && dup[f]) { patch[f] = dup[f] as string; keeper[f] = dup[f]; }
        }
        // Merge tags
        try {
          const a: string[] = JSON.parse((keeper.tags as string) || "[]");
          const b: string[] = JSON.parse((dup.tags as string) || "[]");
          const merged2 = Array.from(new Set([...a, ...b]));
          if (merged2.length > a.length) { patch.tags = JSON.stringify(merged2); keeper.tags = patch.tags; }
        } catch { /* skip */ }
      }

      if (Object.keys(patch).length > 0) {
        const sets = Object.keys(patch).map(k => `"${k}" = ?`).join(", ");
        db.prepare(`UPDATE contacts SET ${sets} WHERE id = ?`).run(...Object.values(patch), keeper.id);
      }

      const dupIds = rest.map(r => r.id as number);
      const ph = dupIds.map(() => "?").join(",");
      db.prepare(`UPDATE activities SET contact_id = ? WHERE contact_id IN (${ph})`).run(keeper.id, ...dupIds);
      db.prepare(`UPDATE contact_enrichments SET contact_id = ? WHERE contact_id IN (${ph})`).run(keeper.id, ...dupIds);
      db.prepare(`UPDATE buildings SET landlord_contact_id = ? WHERE landlord_contact_id IN (${ph})`).run(keeper.id, ...dupIds);
      db.prepare(`DELETE FROM contacts WHERE id IN (${ph})`).run(...dupIds);

      deleted += dupIds.length;
      merged++;
    }

    const remaining = (db.prepare("SELECT count(*) as c FROM contacts").get() as { c: number }).c;
    return { merged, deleted, remaining };
  });

  const result = run();
  return NextResponse.json({ ok: true, ...result });
}

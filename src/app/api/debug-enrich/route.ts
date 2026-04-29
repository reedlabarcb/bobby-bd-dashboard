import { db } from "@/lib/db";
import { tenants, contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { domainSearch } from "@/lib/api/hunter";
import { searchPeople } from "@/lib/api/apollo";
import { NextResponse } from "next/server";

// Debug endpoint: given {tenantId} or {contactId}, returns the RAW Hunter and
// Apollo responses for that company so we can see what each provider is
// actually returning. No DB writes.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    let companyName: string | null = null;
    let contextLabel: string;

    if (body.tenantId) {
      const t = db.select().from(tenants).where(eq(tenants.id, body.tenantId)).get();
      if (!t) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
      companyName = t.name;
      contextLabel = `tenant:${t.id} (${t.name})`;
    } else if (body.contactId) {
      const c = db.select().from(contacts).where(eq(contacts.id, body.contactId)).get();
      if (!c) return NextResponse.json({ error: "contact not found" }, { status: 404 });
      companyName = c.company;
      contextLabel = `contact:${c.id} (${c.name} @ ${c.company || "?"})`;
    } else if (body.company) {
      companyName = body.company;
      contextLabel = `company:${body.company}`;
    } else {
      return NextResponse.json(
        { error: "send {tenantId} or {contactId} or {company}" },
        { status: 400 },
      );
    }

    if (!companyName) {
      return NextResponse.json({ error: "no company name to look up", contextLabel });
    }

    const result: Record<string, unknown> = { context: contextLabel, companyName };

    // Hunter
    if (process.env.HUNTER_API_KEY) {
      try {
        const hunter = await domainSearch({ company: companyName }, { limit: 25, onlyPersonal: true });
        result.hunter = {
          ok: true,
          domain: hunter.domain,
          organization: hunter.organization,
          emailCount: hunter.emails.length,
          firstThree: hunter.emails.slice(0, 3).map((e) => ({
            email: e.value,
            name: [e.first_name, e.last_name].filter(Boolean).join(" "),
            position: e.position,
            confidence: e.confidence,
            phone: e.phone_number,
            linkedin: e.linkedin,
          })),
        };
      } catch (e) {
        result.hunter = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      result.hunter = { ok: false, error: "HUNTER_API_KEY not set" };
    }

    // Apollo
    if (process.env.APOLLO_API_KEY) {
      try {
        const apollo = (await searchPeople({ company: companyName })) as Record<string, unknown>;
        const people = (apollo.people as Array<Record<string, unknown>>) || [];
        const contactsArr = (apollo.contacts as Array<Record<string, unknown>>) || [];
        result.apollo = {
          ok: true,
          peopleCount: people.length,
          contactsCount: contactsArr.length,
          firstThree: [...people, ...contactsArr].slice(0, 3).map((p) => ({
            name: p.name,
            title: p.title,
            email: p.email,
            phoneCount: Array.isArray(p.phone_numbers) ? p.phone_numbers.length : 0,
            organization: (p.organization as Record<string, unknown> | undefined)?.name,
          })),
          paginationHint: apollo.pagination,
        };
      } catch (e) {
        result.apollo = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      result.apollo = { ok: false, error: "APOLLO_API_KEY not set" };
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Debug enrich failed" },
      { status: 500 },
    );
  }
}

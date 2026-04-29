import { db } from "@/lib/db";
import { contacts, contactEnrichments, tenants } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { searchPeople } from "@/lib/api/apollo";
import { domainSearch, findEmail } from "@/lib/api/hunter";
import { NextResponse } from "next/server";

// Bob's approved decision-maker title filter (no Office Manager, no VP Finance).
const DECISION_MAKER_TITLES = [
  "CEO",
  "President",
  "CFO",
  "COO",
  "VP Real Estate",
  "Head of Real Estate",
  "Director of Real Estate",
  "VP Operations",
];

const MAX_HITS_PER_TENANT = 5;

type ApolloPerson = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string | null;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string; type?: string }>;
  linkedin_url?: string;
  city?: string;
  state?: string;
  organization?: { name?: string; primary_domain?: string };
};

function bestPhone(person: ApolloPerson) {
  const phones = person.phone_numbers || [];
  const mobile = phones.find((p) => (p.type || "").toLowerCase().includes("mobile"));
  const direct = phones.find((p) => (p.type || "").toLowerCase().includes("direct"));
  return {
    phone: phones[0]?.sanitized_number || phones[0]?.raw_number || null,
    mobile: mobile?.sanitized_number || mobile?.raw_number || null,
    direct: direct?.sanitized_number || direct?.raw_number || null,
  };
}

export async function POST(request: Request) {
  try {
    const { tenantId } = await request.json();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // PRIMARY: Hunter domain-search. The paid Hunter plan returns up to 100
    // verified emails per call with name + position + linkedin, which gives
    // us much richer hits than Apollo's people-search on the free tier.
    const errors: string[] = [];
    let hunterEmails: Awaited<ReturnType<typeof domainSearch>>["emails"] = [];
    let resolvedOrganization: string | null = null;
    try {
      const hunter = await domainSearch(
        { company: tenant.name },
        { limit: 50, onlyPersonal: true },
      );
      hunterEmails = hunter.emails;
      resolvedOrganization = hunter.organization;
    } catch (e) {
      errors.push(`Hunter: ${e instanceof Error ? e.message : "failed"}`);
    }

    // SECONDARY: Apollo people-search as a fallback when Hunter found nothing.
    let apolloCandidates: ApolloPerson[] = [];
    if (hunterEmails.length === 0) {
      try {
        const apolloRaw = (await searchPeople({
          company: tenant.name,
        })) as Record<string, unknown>;
        apolloCandidates = [
          ...((apolloRaw.people as ApolloPerson[]) || []),
          ...((apolloRaw.contacts as ApolloPerson[]) || []),
        ];
      } catch (e) {
        errors.push(`Apollo: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Normalize Hunter+Apollo into a single candidate shape.
    type Candidate = {
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      mobile: string | null;
      direct: string | null;
      linkedin: string | null;
      city: string | null;
      state: string | null;
      source: "hunter" | "apollo";
      raw: unknown;
    };

    const merged: Candidate[] = [
      ...hunterEmails.map<Candidate>((h) => ({
        name: [h.first_name, h.last_name].filter(Boolean).join(" ").trim(),
        title: h.position,
        email: h.value,
        phone: h.phone_number,
        mobile: null,
        direct: null,
        linkedin: h.linkedin,
        city: null,
        state: null,
        source: "hunter",
        raw: h,
      })),
      ...apolloCandidates.map<Candidate>((p) => {
        const phones = bestPhone(p);
        return {
          name: (p.name || [p.first_name, p.last_name].filter(Boolean).join(" ").trim()),
          title: p.title || null,
          email: p.email || null,
          phone: phones.phone,
          mobile: phones.mobile,
          direct: phones.direct,
          linkedin: p.linkedin_url || null,
          city: p.city || null,
          state: p.state || null,
          source: "apollo",
          raw: p,
        };
      }),
    ].filter((c) => c.name.length > 0);

    // Filter to decision-maker titles. Hunter's `position` and Apollo's
    // `title` are both freeform — substring-match against Bob's approved list.
    const wanted = merged.filter((c) => {
      const title = (c.title || "").toLowerCase();
      if (!title) return false;
      return DECISION_MAKER_TITLES.some((t) => title.includes(t.toLowerCase()));
    });

    // Existing contacts at this tenant (by company-name match) to avoid dupes.
    const existing = db
      .select({ name: contacts.name })
      .from(contacts)
      .where(sql`lower(trim(${contacts.company})) = lower(trim(${tenant.name}))`)
      .all();
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

    const created: number[] = [];
    const skipped: string[] = [];

    for (const person of wanted.slice(0, MAX_HITS_PER_TENANT)) {
      const personName = person.name;
      if (!personName) continue;

      if (existingNames.has(personName.toLowerCase().trim())) {
        skipped.push(personName);
        continue;
      }

      // If Apollo gave us a person but no email, try Hunter findEmail.
      let email = person.email;
      if (!email && person.source === "apollo" && process.env.HUNTER_API_KEY) {
        try {
          const hunter = await findEmail(personName, { company: tenant.name });
          if (hunter.email && hunter.score >= 50) email = hunter.email;
        } catch {
          // best-effort
        }
      }

      const tagsList = [
        "decision-maker",
        "tenant-contact",
        `${person.source}-enriched`,
        `tenantId:${tenant.id}`,
      ];

      const inserted = db
        .insert(contacts)
        .values({
          name: personName,
          email,
          phone: person.phone,
          directPhone: person.direct,
          mobilePhone: person.mobile,
          company: tenant.name,
          title: person.title || null,
          type: "other",
          source: `${person.source}-tenant-enrichment`,
          sourceFile: `enrich-tenant:${tenant.id}`,
          tags: JSON.stringify(tagsList),
          city: person.city || null,
          state: person.state || null,
          notes: person.linkedin ? `LinkedIn: ${person.linkedin}` : null,
        })
        .returning({ id: contacts.id })
        .get();

      created.push(inserted.id);

      // Stash the raw record for later debugging / re-synth.
      db.insert(contactEnrichments)
        .values({
          contactId: inserted.id,
          source: `${person.source}-tenant-search`,
          rawJson: JSON.stringify(person.raw),
        })
        .run();
    }

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      resolvedOrganization,
      hunterCandidates: hunterEmails.length,
      apolloCandidates: apolloCandidates.length,
      candidatesMatchingTitles: wanted.length,
      createdContactIds: created,
      skippedExisting: skipped,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tenant enrichment failed" },
      { status: 500 },
    );
  }
}

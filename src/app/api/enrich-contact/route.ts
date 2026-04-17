import { db } from "@/lib/db";
import { contacts, contactEnrichments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enrichContact as apolloEnrich, searchPeople } from "@/lib/api/apollo";
import { findEmail, verifyEmail } from "@/lib/api/hunter";
import { scrapeLinkedIn } from "@/lib/api/apify";
import { synthesizeContactInfo } from "@/lib/api/anthropic";
import { NextResponse } from "next/server";

function saveEnrichment(contactId: number, source: string, data: unknown) {
  db.insert(contactEnrichments).values({
    contactId,
    source,
    rawJson: JSON.stringify(data),
  }).run();
}

export async function POST(request: Request) {
  try {
    const { contactId } = await request.json();
    if (!contactId) {
      return NextResponse.json({ error: "contactId required" }, { status: 400 });
    }

    const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const enrichmentResults: Record<string, unknown>[] = [];
    const errors: string[] = [];

    // Step 1: Apollo — title, company, phone, LinkedIn URL
    try {
      let apolloData: Record<string, unknown> = {};
      if (contact.email) {
        apolloData = await apolloEnrich(contact.email);
      } else {
        apolloData = await searchPeople({
          name: contact.name,
          company: contact.company || undefined,
          city: contact.city || undefined,
        });
      }
      saveEnrichment(contactId, "apollo", apolloData);
      enrichmentResults.push({ source: "apollo", data: apolloData });
    } catch (e) {
      errors.push(`Apollo: ${e instanceof Error ? e.message : "failed"}`);
    }

    // Step 2: Hunter — find/verify email if missing
    try {
      if (!contact.email && contact.company) {
        const domain = contact.company.toLowerCase().replace(/\s+/g, "") + ".com";
        const hunterData = await findEmail(contact.name, domain);
        saveEnrichment(contactId, "hunter", hunterData);
        enrichmentResults.push({ source: "hunter", data: hunterData });
      } else if (contact.email) {
        const verification = await verifyEmail(contact.email);
        saveEnrichment(contactId, "hunter", verification);
        enrichmentResults.push({ source: "hunter", data: verification });
      }
    } catch (e) {
      errors.push(`Hunter: ${e instanceof Error ? e.message : "failed"}`);
    }

    // Step 3: Apify — scrape LinkedIn if we have a URL
    try {
      const apolloResult = enrichmentResults.find(r => r.source === "apollo");
      const apolloData = apolloResult?.data as Record<string, unknown> | undefined;
      const apolloPerson = apolloData?.person as Record<string, unknown> | undefined;
      const linkedinUrl = (apolloData?.linkedin_url as string)
        || (apolloPerson?.linkedin_url as string);

      if (linkedinUrl && typeof linkedinUrl === "string") {
        const linkedinData = await scrapeLinkedIn(linkedinUrl);
        saveEnrichment(contactId, "apify", linkedinData);
        enrichmentResults.push({ source: "apify", data: linkedinData });
      }
    } catch (e) {
      errors.push(`Apify: ${e instanceof Error ? e.message : "failed"}`);
    }

    // Step 4: Claude — synthesize everything
    let updates: Record<string, string> = {};
    let summary = "";
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        errors.push("Claude: ANTHROPIC_API_KEY not configured");
      } else {
        const synthesis = await synthesizeContactInfo(
          contact.name,
          contact as unknown as Record<string, unknown>,
          enrichmentResults
        );
        saveEnrichment(contactId, "claude", synthesis);
        updates = synthesis.updates;
        summary = synthesis.summary;
      }
    } catch (e) {
      errors.push(`Claude: ${e instanceof Error ? e.message : "failed"}`);
    }

    // Build diff of what would change
    const diff: Record<string, { old: string | null; new: string }> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value && value !== (contact as unknown as Record<string, string>)[key]) {
        diff[key] = {
          old: (contact as unknown as Record<string, string | null>)[key] || null,
          new: value,
        };
      }
    }
    if (summary) {
      diff.notes = {
        old: contact.notes || null,
        new: contact.notes ? `${contact.notes}\n\n---\nAI Summary: ${summary}` : `AI Summary: ${summary}`,
      };
    }

    return NextResponse.json({ diff, errors, enrichmentCount: enrichmentResults.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}

// Apply the enrichment diff
export async function PUT(request: Request) {
  try {
    const { contactId, updates } = await request.json();
    if (!contactId || !updates) {
      return NextResponse.json({ error: "contactId and updates required" }, { status: 400 });
    }

    const result = db.update(contacts)
      .set({
        ...updates,
        updatedAt: new Date().toISOString().replace("T", " ").split(".")[0],
      })
      .where(eq(contacts.id, contactId))
      .returning()
      .get();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply updates" },
      { status: 500 }
    );
  }
}

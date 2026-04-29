import { db } from "@/lib/db";
import { contacts, contactEnrichments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enrichContact as apolloEnrich, searchPeople } from "@/lib/api/apollo";
import { domainSearch, findEmail, verifyEmail } from "@/lib/api/hunter";
import { scrapeLinkedIn } from "@/lib/api/apify";
import { synthesizeContactInfo } from "@/lib/api/anthropic";
import { NextResponse } from "next/server";

// Loose name match: fold case + diacritics + trim, then check that all
// last-name tokens appear in the candidate's full name. This handles
// "Hanna" vs "John Hanna" and "Susan Green" vs "Green, Susan".
function namesMatch(target: string, candidateFirst: string | null, candidateLast: string | null): boolean {
  const candidate = [candidateFirst, candidateLast].filter(Boolean).join(" ").toLowerCase().trim();
  if (!candidate) return false;
  const targetTokens = target
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (targetTokens.length === 0) return false;
  return targetTokens.every((t) => candidate.includes(t));
}

function saveEnrichment(contactId: number, source: string, data: unknown) {
  db.insert(contactEnrichments).values({
    contactId,
    source,
    rawJson: JSON.stringify(data),
  }).run();
}

export async function POST(request: Request) {
  try {
    const { contactId, autoApply } = await request.json();
    if (!contactId) {
      return NextResponse.json({ error: "contactId required" }, { status: 400 });
    }

    const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const enrichmentResults: Record<string, unknown>[] = [];
    const errors: string[] = [];

    // LinkedIn URLs from the prospecting-sheet importer land in `notes`. Pull
    // it out as the strongest signal we have — it's a person-specific URL that
    // already maps to this contact, no fuzzy matching needed.
    const linkedinFromNotes = contact.notes?.match(
      /linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i,
    )?.[0];
    const linkedinFullUrl = linkedinFromNotes ? `https://www.${linkedinFromNotes}` : null;

    // Step 1: Apify LinkedIn scrape — runs first when we already have a LinkedIn
    // URL on the contact. LinkedIn has the most reliable title + company data
    // and bypasses the Hunter coverage problem entirely. Skipped silently if
    // APIFY_API_KEY isn't configured.
    let apifyData: Record<string, unknown> | null = null;
    if (linkedinFullUrl && process.env.APIFY_API_KEY) {
      try {
        apifyData = await scrapeLinkedIn(linkedinFullUrl);
        saveEnrichment(contactId, "apify", apifyData);
        enrichmentResults.push({ source: "apify", data: apifyData });
      } catch (e) {
        errors.push(`Apify: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Step 2a: Hunter domain-search — pull the full org email list and
    // match by name. This is the highest-yield Hunter call when Apollo's
    // free-tier search returns redacted records (which it usually does).
    let hunterDomainHit: Record<string, unknown> | null = null;
    if (contact.company && process.env.HUNTER_API_KEY) {
      try {
        const ds = await domainSearch(
          { company: contact.company },
          { limit: 100, onlyPersonal: true },
        );
        const match = ds.emails.find((e) =>
          namesMatch(contact.name, e.first_name, e.last_name),
        );
        if (match) {
          hunterDomainHit = {
            email: match.value,
            position: match.position,
            phone: match.phone_number,
            linkedin: match.linkedin,
            confidence: match.confidence,
            organization: ds.organization,
          };
          saveEnrichment(contactId, "hunter-domain", hunterDomainHit);
          enrichmentResults.push({ source: "hunter-domain", data: hunterDomainHit });
        } else if (ds.emails.length === 0) {
          // No coverage for this company at all. Surface it so the UI shows it.
          errors.push(
            `Hunter: no emails crawled for ${ds.organization || contact.company}${ds.domain ? ` (${ds.domain})` : ""}`,
          );
        } else {
          // Hunter has the company but couldn't match the name.
          errors.push(
            `Hunter: ${ds.emails.length} emails at ${ds.organization || contact.company} but no match for "${contact.name}"`,
          );
        }
      } catch (e) {
        errors.push(`Hunter domain-search: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Step 2b: Hunter find-email or verify. Skip if domain-search already
    // found this person — the domain hit has the email already.
    try {
      if (!hunterDomainHit && !contact.email && contact.company) {
        const hunterData = await findEmail(contact.name, {
          company: contact.company,
        });
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

    // Step 3: Apollo — last-resort fallback. Often 403s on free-tier search
    // (mixed_people/search requires paid plan now). If we already have a
    // hit from Apify or Hunter, skip to save the credit.
    if (!apifyData && !hunterDomainHit) {
      try {
        let apolloData: Record<string, unknown> = {};
        if (contact.email) {
          apolloData = await apolloEnrich(contact.email);
        } else {
          apolloData = await searchPeople({
            name: contact.name,
            company: contact.company || undefined,
            city: contact.city || undefined,
            linkedinUrl: linkedinFullUrl || undefined,
          });
        }
        saveEnrichment(contactId, "apollo", apolloData);
        enrichmentResults.push({ source: "apollo", data: apolloData });
      } catch (e) {
        errors.push(`Apollo: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Step 4: build deterministic updates from the strongest signals first.
    // Claude only refines / adds a summary on top — we don't gate the diff
    // on Claude succeeding, so a transient Anthropic failure doesn't kill
    // an otherwise-good Hunter hit.
    const updates: Record<string, string> = {};

    function setIfBetter(field: string, value: string | null | undefined) {
      if (!value) return;
      const current = (contact as unknown as Record<string, string | null>)[field];
      if (current && current.length > 0) return; // never overwrite existing data here
      updates[field] = value;
    }

    // Apify (LinkedIn scrape) wins for title/location since LinkedIn is the
    // authoritative source for those.
    if (apifyData) {
      const headline = (apifyData.headline as string | undefined)
        || (apifyData.position as string | undefined)
        || (apifyData.jobTitle as string | undefined);
      const location = apifyData.location as string | undefined;
      const summary = apifyData.summary as string | undefined;
      setIfBetter("title", headline ?? null);
      if (location) {
        const [city, state] = location.split(",").map((s) => s.trim());
        setIfBetter("city", city ?? null);
        setIfBetter("state", state ?? null);
      }
      if (summary && !(contact.notes || "").includes(summary.slice(0, 30))) {
        const prefix = contact.notes ? `${contact.notes}\n\n` : "";
        updates.notes = `${prefix}Bio: ${summary.slice(0, 500)}`;
      }
      // Apify rarely returns email/phone but try anyway.
      setIfBetter("email", (apifyData.email as string | undefined) ?? null);
    }

    if (hunterDomainHit) {
      setIfBetter("email", hunterDomainHit.email as string | null);
      setIfBetter("phone", hunterDomainHit.phone as string | null);
      setIfBetter("title", hunterDomainHit.position as string | null);
      // Stash LinkedIn into notes if not already there.
      const li = hunterDomainHit.linkedin as string | null;
      if (li && !(contact.notes || "").includes(li)) {
        const prefix = contact.notes ? `${contact.notes}\n` : "";
        updates.notes = `${prefix}LinkedIn: ${li}`;
      }
    }

    // Pull anything else Hunter findEmail / Apollo gave us.
    const hunterFind = enrichmentResults.find((r) => r.source === "hunter")?.data as
      | { email?: string | null; score?: number }
      | undefined;
    if (hunterFind?.email && (hunterFind.score ?? 0) >= 50) {
      setIfBetter("email", hunterFind.email);
    }

    let summary = "";
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const synthesis = await synthesizeContactInfo(
          contact.name,
          contact as unknown as Record<string, unknown>,
          enrichmentResults,
        );
        saveEnrichment(contactId, "claude", synthesis);
        // Claude can fill in fields we still don't have, but never overwrites
        // what we already chose deterministically above.
        for (const [k, v] of Object.entries(synthesis.updates || {})) {
          if (v && !updates[k]) {
            const current = (contact as unknown as Record<string, string | null>)[k];
            if (!current) updates[k] = v;
          }
        }
        summary = synthesis.summary;
      } else {
        errors.push("Claude: ANTHROPIC_API_KEY not configured");
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

    // Bulk mode: apply the diff immediately and return what was applied. Used
    // by the /enrich bulk runner so we don't need a per-contact PUT roundtrip.
    let applied = false;
    if (autoApply && Object.keys(diff).length > 0) {
      const updateValues: Record<string, string> = {};
      for (const [k, v] of Object.entries(diff)) updateValues[k] = v.new;
      db.update(contacts)
        .set({
          ...updateValues,
          updatedAt: new Date().toISOString().replace("T", " ").split(".")[0],
        })
        .where(eq(contacts.id, contactId))
        .run();
      applied = true;
    }

    return NextResponse.json({ diff, applied, errors, enrichmentCount: enrichmentResults.length });
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

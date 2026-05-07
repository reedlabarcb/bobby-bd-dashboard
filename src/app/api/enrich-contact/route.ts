import { db } from "@/lib/db";
import { contacts, contactEnrichments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  searchPeople as apolloSearchPeople,
  searchOrganization as apolloSearchOrg,
  ApolloFreeTierError,
} from "@/lib/api/apollo";
import { domainSearch, findEmail, verifyEmail } from "@/lib/api/hunter";
import { scrapeLinkedIn } from "@/lib/api/apify";
import { enrichPerson as pdlEnrichPerson } from "@/lib/api/pdl";
import { synthesizeContactInfo } from "@/lib/api/anthropic";
import { NextResponse } from "next/server";

// Loose name match: fold case + diacritics + trim, then check that all
// last-name tokens appear in the candidate's full name.
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
    const notFound: string[] = []; // expected misses, not failures

    // LinkedIn URL embedded in notes is a person-specific signal we trust.
    const linkedinFromNotes = contact.notes?.match(
      /linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i,
    )?.[0];
    const linkedinFullUrl = linkedinFromNotes ? `https://www.${linkedinFromNotes}` : null;

    // ─────────────────────────────────────────────────────────────
    // PIPELINE ORDER (v2):
    //   1. Apollo search (name + company, free-tier endpoint)
    //   2. Hunter domain-search
    //   3. Hunter find-email / verify-email
    //   4. PDL enrichPerson (only if 1+2+3 missed email/phone)
    //   5. Apify LinkedIn (only if a LinkedIn URL exists)
    //   6. Claude synthesizeContactInfo (always last, fills blanks)
    // ─────────────────────────────────────────────────────────────

    // Step 1: Apollo search by name + company (free-tier).
    let apolloHit: Record<string, unknown> | null = null;
    let apolloOrgDomain: string | null = null;
    if (process.env.APOLLO_API_KEY) {
      try {
        const result = await apolloSearchPeople({
          name: contact.name,
          company: contact.company || undefined,
          city: contact.city || undefined,
        });
        const people = (result.people as Array<Record<string, unknown>> | undefined) ?? [];
        if (people.length > 0) {
          apolloHit = people[0];
          saveEnrichment(contactId, "apollo", apolloHit);
          enrichmentResults.push({ source: "apollo", data: apolloHit });
        } else {
          notFound.push(`Apollo: no people found for "${contact.name}" at "${contact.company}"`);
        }
      } catch (e) {
        if (e instanceof ApolloFreeTierError) {
          notFound.push("Apollo free tier limited (skipping people-search)");
        } else {
          errors.push(`Apollo: ${e instanceof Error ? e.message : "failed"}`);
        }
      }

      // Org-search fallback to find a domain we can hand to Hunter.
      if (contact.company && !apolloOrgDomain) {
        try {
          const org = await apolloSearchOrg(contact.company);
          if (org?.domain) {
            apolloOrgDomain = org.domain;
            enrichmentResults.push({ source: "apollo-org", data: org });
          }
        } catch (e) {
          if (!(e instanceof ApolloFreeTierError)) {
            errors.push(`Apollo org-search: ${e instanceof Error ? e.message : "failed"}`);
          }
        }
      }
    } else {
      notFound.push("Apollo not configured");
    }

    // Step 2: Hunter domain-search — try with Apollo's discovered domain
    // first, fall back to company name (Hunter's own domain inference).
    let hunterDomainHit: Record<string, unknown> | null = null;
    if (contact.company && process.env.HUNTER_API_KEY) {
      try {
        const ds = await domainSearch(
          apolloOrgDomain
            ? { domain: apolloOrgDomain }
            : { company: contact.company },
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
          notFound.push(
            `Hunter has no email index for ${ds.organization || contact.company}${ds.domain ? ` (${ds.domain})` : ""}`,
          );
        } else {
          notFound.push(
            `Hunter has ${ds.emails.length} emails at ${ds.organization || contact.company} but none match "${contact.name}"`,
          );
        }
      } catch (e) {
        errors.push(`Hunter domain-search: ${e instanceof Error ? e.message : "failed"}`);
      }
    } else if (!process.env.HUNTER_API_KEY) {
      notFound.push("Hunter not configured");
    }

    // Step 3: Hunter find-email / verify-email — fallback if domain-search
    // didn't get a name match but we still don't have an email.
    let hunterFindHit: { email?: string; score?: number } | null = null;
    if (process.env.HUNTER_API_KEY) {
      try {
        if (!hunterDomainHit && !contact.email && contact.company) {
          const hunterData = await findEmail(contact.name, {
            company: contact.company,
          });
          hunterFindHit = hunterData as { email?: string; score?: number };
          saveEnrichment(contactId, "hunter", hunterData);
          enrichmentResults.push({ source: "hunter", data: hunterData });
        } else if (contact.email) {
          const verification = await verifyEmail(contact.email);
          saveEnrichment(contactId, "hunter", verification);
          enrichmentResults.push({ source: "hunter", data: verification });
        }
      } catch (e) {
        errors.push(`Hunter find-email: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Step 4: PDL enrichPerson — only if Apollo and Hunter didn't yield
    // an email or phone yet. Conservative — PDL free tier is 100/mo.
    const haveEmail =
      contact.email ||
      (hunterDomainHit?.email as string | undefined) ||
      hunterFindHit?.email ||
      (apolloHit?.email as string | undefined);
    const havePhone =
      contact.phone ||
      (hunterDomainHit?.phone as string | undefined) ||
      (apolloHit?.organization_phone as string | undefined);
    let pdlHit: Awaited<ReturnType<typeof pdlEnrichPerson>> | null = null;
    if (!haveEmail || !havePhone) {
      if (process.env.PDL_API_KEY && contact.company) {
        try {
          pdlHit = await pdlEnrichPerson(
            contact.name,
            contact.company,
            contact.email || undefined,
          );
          if (pdlHit) {
            saveEnrichment(contactId, "pdl", pdlHit);
            enrichmentResults.push({ source: "pdl", data: pdlHit });
          } else {
            notFound.push(`PDL: no match for "${contact.name}" at "${contact.company}"`);
          }
        } catch (e) {
          errors.push(`PDL: ${e instanceof Error ? e.message : "failed"}`);
        }
      } else if (!process.env.PDL_API_KEY) {
        notFound.push("PDL not configured");
      }
    }

    // Step 5: Apify LinkedIn — only when a LinkedIn URL is on the contact.
    let apifyHit: Awaited<ReturnType<typeof scrapeLinkedIn>> | null = null;
    if (linkedinFullUrl) {
      if (process.env.APIFY_API_KEY) {
        try {
          apifyHit = await scrapeLinkedIn(linkedinFullUrl);
          saveEnrichment(contactId, "apify", apifyHit);
          enrichmentResults.push({ source: "apify", data: apifyHit });
        } catch (e) {
          errors.push(`Apify: ${e instanceof Error ? e.message : "failed"}`);
        }
      } else {
        notFound.push("Apify not configured (have LinkedIn URL but can't scrape)");
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Build deterministic updates from strongest signals first.
    // Rule: never overwrite a non-empty existing field.
    // ─────────────────────────────────────────────────────────────
    const updates: Record<string, string> = {};

    function setIfBetter(field: string, value: string | null | undefined) {
      if (!value) return;
      const current = (contact as unknown as Record<string, string | null>)[field];
      if (current && current.length > 0) return;
      updates[field] = value;
    }

    // Apify (LinkedIn) wins for title/location — LinkedIn is authoritative.
    if (apifyHit) {
      setIfBetter("title", apifyHit.headline ?? apifyHit.currentRole);
      if (apifyHit.location) {
        const [city, state] = apifyHit.location.split(",").map((s) => s.trim());
        setIfBetter("city", city ?? null);
        setIfBetter("state", state ?? null);
      }
      setIfBetter("email", apifyHit.email);
      setIfBetter("phone", apifyHit.phone);
    }

    // Hunter domain-search hit — verified email + position from the company.
    if (hunterDomainHit) {
      setIfBetter("email", hunterDomainHit.email as string | null);
      setIfBetter("phone", hunterDomainHit.phone as string | null);
      setIfBetter("title", hunterDomainHit.position as string | null);
      const li = hunterDomainHit.linkedin as string | null;
      if (li && !(contact.notes || "").includes(li)) {
        const prefix = contact.notes ? `${contact.notes}\n` : "";
        updates.notes = `${prefix}LinkedIn: ${li}`;
      }
    }

    if (hunterFindHit?.email && (hunterFindHit.score ?? 0) >= 50) {
      setIfBetter("email", hunterFindHit.email);
    }

    // PDL (after the verified Hunter email/phone, since PDL data can be older).
    if (pdlHit) {
      setIfBetter("email", pdlHit.email);
      setIfBetter("phone", pdlHit.phone);
      setIfBetter("title", pdlHit.title);
      setIfBetter("city", pdlHit.city);
      setIfBetter("state", pdlHit.state);
    }

    // Apollo person hit (free-tier records are partial / often redacted).
    if (apolloHit) {
      setIfBetter("title", apolloHit.title as string | null);
      setIfBetter(
        "city",
        ((apolloHit.city as string | undefined) ??
          (apolloHit.present_raw_address as string | undefined)) ?? null,
      );
    }

    // Step 6: Claude — synthesize a summary + fill any remaining gaps.
    let summary = "";
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const synthesis = await synthesizeContactInfo(
          contact.name,
          contact as unknown as Record<string, unknown>,
          enrichmentResults,
        );
        saveEnrichment(contactId, "claude", synthesis);
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

    // Build diff of what would change.
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
      // Strip any existing "AI Summary:" block before appending the new
      // one — re-enriching shouldn't pile up duplicate summaries.
      const baseNotes = (contact.notes || "")
        .replace(/\s*(?:\n?---\n)?\s*AI Summary:[\s\S]*$/, "")
        .trimEnd();
      diff.notes = {
        old: contact.notes || null,
        new: baseNotes ? `${baseNotes}\n\n---\nAI Summary: ${summary}` : `AI Summary: ${summary}`,
      };
    }

    // Bulk mode: apply the diff immediately and return what was applied.
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

    return NextResponse.json({
      diff,
      applied,
      errors,
      notFound,
      enrichmentCount: enrichmentResults.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enrichment failed" },
      { status: 500 },
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
      { status: 500 },
    );
  }
}

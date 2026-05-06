import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { documents, tenants, leases, deals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

type ExtractedData = {
  documentType: string;
  propertyName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyType: string;
  askingPrice: number | null;
  summary: string;
  brokerInfo: {
    name: string;
    company: string;
    phone: string;
    email: string;
  } | null;
  tenants: Array<{
    name: string;
    industry: string | null;
    creditRating: string | null;
    parentCompany: string | null;
    suiteUnit: string | null;
    squareFeet: number | null;
    leaseStartDate: string | null;
    leaseEndDate: string | null;
    rentPsf: number | null;
    annualRent: number | null;
    leaseType: string | null;
    options: string | null;
    escalations: string | null;
  }>;
  keyHighlights: string[];
};

export async function processDocument(documentId: number, pdfBase64: string): Promise<void> {
  // Mark as processing
  db.update(documents)
    .set({ status: "processing" })
    .where(eq(documents.id, documentId))
    .run();

  try {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            {
              type: "text",
              text: `You are an expert commercial real estate analyst. Extract ALL available data from this document.

Return ONLY valid JSON with this exact structure:
{
  "documentType": "om|rent_roll|lease_abstract|market_report|other",
  "propertyName": "name of the property",
  "propertyAddress": "full street address",
  "propertyCity": "city",
  "propertyState": "2-letter state code",
  "propertyType": "office|retail|industrial|multifamily|hospitality|land|mixed-use|other",
  "askingPrice": numeric or null,
  "summary": "3-5 sentence summary of the document and opportunity",
  "brokerInfo": {"name": "", "company": "", "phone": "", "email": ""} or null,
  "tenants": [
    {
      "name": "tenant company name",
      "industry": "tenant's industry or null",
      "creditRating": "investment-grade|national|regional|local or null",
      "parentCompany": "parent company if subsidiary, or null",
      "suiteUnit": "suite/unit number or null",
      "squareFeet": numeric SF or null,
      "leaseStartDate": "YYYY-MM-DD or null",
      "leaseEndDate": "YYYY-MM-DD or null — THIS IS CRITICAL, extract lease expiration dates whenever possible",
      "rentPsf": numeric rent per SF or null,
      "annualRent": numeric annual rent or null,
      "leaseType": "NNN|gross|modified_gross|ground or null",
      "options": "renewal options, expansion rights, etc. or null",
      "escalations": "rent escalation terms or null"
    }
  ],
  "keyHighlights": ["highlight 1", "highlight 2", ...]
}

CRITICAL INSTRUCTIONS:
- Extract EVERY tenant and their lease terms. This is the most important data.
- For lease end dates, look for: expiration dates, lease term end dates, remaining term language (e.g. "5 years remaining" = current date + 5 years)
- If a rent roll is included, extract every row as a tenant entry
- If lease dates are approximate or estimated, still include them with your best guess
- For multi-tenant properties, capture ALL tenants, not just the major ones
- Include vacant suites as tenants with name "VACANT"`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse Claude response as JSON");

    const extracted: ExtractedData = JSON.parse(jsonMatch[0]);

    // Compute months remaining for each lease
    const now = new Date();
    for (const t of extracted.tenants) {
      if (t.leaseEndDate) {
        const endDate = new Date(t.leaseEndDate);
        const diffMs = endDate.getTime() - now.getTime();
        const months = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.44));
        (t as Record<string, unknown>).monthsRemaining = months;
      }
    }

    // Save extracted data to document record
    db.update(documents)
      .set({
        status: "done",
        documentType: extracted.documentType,
        propertyName: extracted.propertyName,
        propertyAddress: extracted.propertyAddress,
        propertyCity: extracted.propertyCity,
        propertyState: extracted.propertyState,
        propertyType: extracted.propertyType,
        askingPrice: extracted.askingPrice,
        aiSummary: extracted.summary,
        rawExtracted: JSON.stringify(extracted),
        processedAt: new Date().toISOString().replace("T", " ").split(".")[0],
      })
      .where(eq(documents.id, documentId))
      .run();

    // Create or link a deal
    const deal = db.insert(deals).values({
      name: extracted.propertyName || "Untitled Deal",
      propertyType: extracted.propertyType,
      address: extracted.propertyAddress,
      city: extracted.propertyCity,
      state: extracted.propertyState,
      askingPrice: extracted.askingPrice,
      status: "prospect",
      sourceFile: db.select({ filename: documents.filename }).from(documents).where(eq(documents.id, documentId)).get()?.filename,
      aiSummary: extracted.summary,
      rawText: JSON.stringify({ highlights: extracted.keyHighlights, brokerInfo: extracted.brokerInfo }),
    }).returning().get();

    // Link document to deal
    db.update(documents)
      .set({ dealId: deal.id })
      .where(eq(documents.id, documentId))
      .run();

    // Save tenants and leases
    for (const t of extracted.tenants) {
      // Find or create tenant
      let tenant = db.select().from(tenants)
        .where(eq(tenants.name, t.name))
        .get();

      if (!tenant) {
        tenant = db.insert(tenants).values({
          name: t.name,
          industry: t.industry,
          creditRating: t.creditRating,
          parentCompany: t.parentCompany,
        }).returning().get();
      }

      // Create lease record
      db.insert(leases).values({
        tenantId: tenant.id,
        documentId,
        dealId: deal.id,
        propertyName: extracted.propertyName,
        propertyAddress: extracted.propertyAddress,
        propertyCity: extracted.propertyCity,
        propertyState: extracted.propertyState,
        propertyType: extracted.propertyType,
        suiteUnit: t.suiteUnit,
        squareFeet: t.squareFeet,
        leaseStartDate: t.leaseStartDate,
        leaseEndDate: t.leaseEndDate,
        monthsRemaining: (t as Record<string, unknown>).monthsRemaining as number | undefined,
        rentPsf: t.rentPsf,
        annualRent: t.annualRent,
        leaseType: t.leaseType,
        options: t.options,
        escalations: t.escalations,
        sourceFile: db.select({ filename: documents.filename }).from(documents).where(eq(documents.id, documentId)).get()?.filename,
        confidence: "high",
      }).run();
    }
  } catch (error) {
    db.update(documents)
      .set({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Processing failed",
      })
      .where(eq(documents.id, documentId))
      .run();
    throw error;
  }
}

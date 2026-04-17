import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function parseOfferingMemorandum(pdfBase64: string): Promise<{
  name: string;
  propertyType: string;
  address: string;
  city: string;
  state: string;
  askingPrice: number | null;
  highlights: string[];
  brokerInfo: string;
  summary: string;
}> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
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
            text: `You are a commercial real estate analyst. Extract the following from this Offering Memorandum PDF and return ONLY valid JSON:
{
  "name": "property name",
  "propertyType": "office/retail/industrial/multifamily/hospitality/land/mixed-use/other",
  "address": "full street address",
  "city": "city",
  "state": "state abbreviation",
  "askingPrice": numeric price or null if not listed,
  "highlights": ["key highlight 1", "key highlight 2", "key highlight 3"],
  "brokerInfo": "broker name, company, phone, email if available",
  "summary": "3-sentence summary of the property and opportunity"
}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse Claude response as JSON");
  return JSON.parse(jsonMatch[0]);
}

export async function synthesizeContactInfo(
  contactName: string,
  existingData: Record<string, unknown>,
  enrichmentData: Record<string, unknown>[]
): Promise<{ summary: string; updates: Record<string, string> }> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `You are a CRE research assistant. Synthesize the following data about "${contactName}" into a clean contact profile.

Existing contact data:
${JSON.stringify(existingData, null, 2)}

Enrichment data from various sources:
${JSON.stringify(enrichmentData, null, 2)}

Return ONLY valid JSON:
{
  "summary": "2-3 sentence professional summary of this person",
  "updates": {
    "title": "their job title if found",
    "company": "their company if found",
    "email": "their email if found and not already known",
    "phone": "their phone if found and not already known",
    "city": "their city if found",
    "state": "their state if found",
    "notes": "any additional relevant info for a CRE broker"
  }
}
Only include fields in "updates" where you found new or better data. Omit fields that are already correct or unknown.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse Claude response");
  return JSON.parse(jsonMatch[0]);
}

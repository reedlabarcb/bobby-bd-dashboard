import { db } from "@/lib/db";
import { buildings, contacts, leases, tenants, uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import {
  countLandlords,
  countTable,
  monthsBetween,
  normDate,
  normLeaseType,
  normPropertyClass,
  parseSublease,
  pickStr,
  splitBrokers,
  toFloat,
  toInt,
  upsertBuilding,
  upsertContact,
  upsertLandlordContact,
  upsertLease,
  upsertTenantCompany,
  type RowContext,
} from "@/lib/import-helpers";

// Importer for the "Master Office Lease Comps — All Tenants Decision Makers"
// dataset. Schema differs from the prospecting sheets:
//   - Rents stored under "Actual Gross Base Rent" / "Actual Net Base Rent" /
//     "Effective Rent" (all $/sf/MONTH).
//   - Decision-maker contacts split into DM1_/DM2_/DM3_ column families with
//     Name, Title, LinkedIn, Phone, Email each.
//   - Leasing/Tenant agents are in dedicated company + contact columns.
//   - Landlord lives in "History Building Owner Co of Record".
//   - Rent type is a coded vocabulary (+E, +U, NNN, FS, MG, G) — normalized
//     by normLeaseType.

type Row = Record<string, unknown>;

function dmEmail(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toUpperCase() === "NULL" || !s.includes("@")) return null;
  return s.toLowerCase();
}

function dmStr(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toUpperCase() === "NULL") return null;
  return s;
}

export async function POST(request: Request) {
  try {
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const headerSecret = request.headers.get("x-upload-secret");
      if (!headerSecret || headerSecret !== serverSecret) {
        return NextResponse.json({ error: "Invalid upload secret" }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const ctx: RowContext = { sourceFile: file.name };
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });

    const upload = db
      .insert(uploads)
      .values({ filename: file.name, fileType: "excel", status: "processing" })
      .returning()
      .get();

    const stats = {
      sheets: 0,
      rowsProcessed: 0,
      rowsSkipped: 0,
      buildingsCreated: 0,
      tenantsCreated: 0,
      leasesInserted: 0,
      contactsCreated: 0,
      landlordContactsCreated: 0,
      decisionMakersExtracted: 0,
      brokersExtracted: 0,
      errors: [] as string[],
    };

    const beforeBuildings = countTable(buildings);
    const beforeTenants = countTable(tenants);
    const beforeLeases = countTable(leases);
    const beforeContacts = countTable(contacts);
    const beforeLandlords = countLandlords();

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: Row[] = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (rows.length === 0) continue;
      stats.sheets++;

      for (const row of rows) {
        try {
          const address = pickStr(row, "Address Line 1", "Address");
          if (!address) {
            stats.rowsSkipped++;
            continue;
          }

          const propertyName = pickStr(row, "Building Name");
          // Master Comps' "Market" doubles as the city for North County buildings.
          const city = pickStr(row, "Market ", "Market", "City");
          const propertyClass = normPropertyClass(pickStr(row, "Building Class ", "Building Class"));
          const lessor = pickStr(row, "History Building Owner Co of Record", "Landlord");
          const tenantAgentRaw = pickStr(row, "Tenant Agent Contact");
          const tenantAgency = pickStr(row, "Tenant Agent Company");
          const listingAgentRaw = pickStr(row, "Leasing Agent Contact");
          const listingAgency = pickStr(row, "Leasing Agent Company Name");

          const landlordContactId = lessor ? upsertLandlordContact(lessor, ctx) : null;

          const buildingId = upsertBuilding(
            {
              name: propertyName,
              address,
              city,
              propertyClass,
              propertySubtype: null,
              propertySizeSf: null,
              landlordName: lessor,
              landlordContactId,
            },
            ctx
          );

          const tenantName = pickStr(row, "Tenant Name");
          if (!tenantName) {
            stats.rowsSkipped++;
            continue;
          }
          const industry = pickStr(row, "Tenant Business Type");
          const tenantId = upsertTenantCompany(tenantName, industry);

          const startDate = normDate(row["Date Leased"] ?? row["Date Occupied"]);
          const endDate = normDate(row["Date Lease Expires"]);
          const areaLeased = toInt(pickStr(row, "Leased SF"));
          const suite = pickStr(row, "Suite");
          const floor = pickStr(row, "Floor");
          const transactionType = pickStr(row, "Lease Transaction Type");
          const notes = pickStr(row, "Deal Point Comment");

          // Rents are $/sf/month → annual.
          const grossMonthly = toFloat(row["Actual Gross Base Rent"]);
          const effectiveMonthly = toFloat(row["Effective Rent"]);
          const rentPsf = grossMonthly != null ? +(grossMonthly * 12).toFixed(4) : null;
          const effectiveRent =
            effectiveMonthly != null ? +(effectiveMonthly * 12).toFixed(4) : null;
          const annualRent =
            rentPsf != null && areaLeased != null ? Math.round(rentPsf * areaLeased) : null;
          const leaseType = normLeaseType(pickStr(row, "Lease Rent Type"));
          const tiAllowance = toFloat(row["Tenant Improvements"]);
          const freeRentMonthsRaw = pickStr(row, "Free Rent Months");
          const escalationPercent = toFloat(row["Deal Point Escalations"]);
          const isSublease = parseSublease(pickStr(row, "Sublease (Yes,No)", "Sublease"));

          let monthsRemaining: number | null = null;
          if (endDate) {
            const end = new Date(endDate);
            const now = new Date();
            if (!isNaN(end.getTime())) monthsRemaining = monthsBetween(now, end);
          }

          upsertLease(
            {
              tenantId,
              buildingId,
              propertyName,
              propertyAddress: address,
              propertyCity: city,
              propertyState: "CA",
              propertyType: "office",
              suiteUnit: suite,
              floor,
              squareFeet: areaLeased,
              leaseStartDate: startDate,
              leaseEndDate: endDate,
              monthsRemaining,
              rentPsf,
              effectiveRent,
              annualRent,
              leaseType,
              transactionType,
              tiAllowance,
              freeRentMonths: freeRentMonthsRaw,
              escalationPercent,
              isSublease,
              tenantAgent: tenantAgentRaw,
              tenantAgency,
              listingAgent: listingAgentRaw,
              listingAgency,
              notes,
              sourceFile: ctx.sourceFile,
              confidence: "high", // curated dataset
            },
            { tenantId, buildingId, startDate }
          );

          // Decision makers (DM1/DM2/DM3) — sparse but high signal when present.
          for (const i of [1, 2, 3] as const) {
            const name = dmStr(pickStr(row, `DM${i}_Name`));
            if (!name) continue;
            const title = dmStr(pickStr(row, `DM${i}_Title`));
            const linkedin = dmStr(pickStr(row, `DM${i}_LinkedIn`));
            const phone = dmStr(pickStr(row, `DM${i}_Phone`));
            const email = dmEmail(pickStr(row, `DM${i}_Email`));
            upsertContact(
              {
                name,
                title,
                email,
                phone,
                company: tenantName,
                type: "other",
                tags: ["tenant-contact", "decision-maker"],
                notes: linkedin ? `LinkedIn: ${linkedin}` : null,
              },
              ctx
            );
            stats.decisionMakersExtracted++;
          }

          // Tenant-side brokers (comma-separated).
          for (const agent of splitBrokers(tenantAgentRaw)) {
            upsertContact(
              { name: agent, company: tenantAgency, type: "broker", tags: ["tenant-broker"] },
              ctx
            );
            stats.brokersExtracted++;
          }
          // Landlord-side (listing) brokers.
          for (const agent of splitBrokers(listingAgentRaw)) {
            upsertContact(
              { name: agent, company: listingAgency, type: "broker", tags: ["listing-broker"] },
              ctx
            );
            stats.brokersExtracted++;
          }

          stats.rowsProcessed++;
        } catch (err) {
          stats.errors.push(
            `Sheet "${sheetName}" row: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }
    }

    stats.buildingsCreated = countTable(buildings) - beforeBuildings;
    stats.tenantsCreated = countTable(tenants) - beforeTenants;
    stats.leasesInserted = countTable(leases) - beforeLeases;
    stats.contactsCreated = countTable(contacts) - beforeContacts;
    stats.landlordContactsCreated = countLandlords() - beforeLandlords;

    db.update(uploads)
      .set({
        status: "done",
        recordsCreated: stats.leasesInserted + stats.contactsCreated,
      })
      .where(eq(uploads.id, upload.id))
      .run();

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

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
  normPropertyClass,
  parsePhones,
  parseSublease,
  pickStr,
  splitBrokers,
  splitEmails,
  splitMultiName,
  toFloat,
  toInt,
  upsertBuilding,
  upsertContact,
  upsertLandlordContact,
  upsertLease,
  upsertTenantCompany,
  type RowContext,
} from "@/lib/import-helpers";

// Centerpoint + LXD prospecting-sheet importer. The two schemas overlap heavily
// — column aliases below cover both.

type Row = Record<string, unknown>;

export async function POST(request: Request) {
  try {
    // Belt-and-suspenders shared-secret check for the watcher path. The auth
    // proxy already gates this route for browser sessions; only reject if a
    // header is sent and doesn't match. Missing header = trust the proxy.
    const serverSecret = process.env.UPLOAD_SECRET;
    if (serverSecret) {
      const headerSecret = request.headers.get("x-upload-secret");
      if (headerSecret && headerSecret !== serverSecret) {
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
          const address = pickStr(row, "Address", "address");
          if (!address) {
            stats.rowsSkipped++;
            continue;
          }

          const propertyName = pickStr(row, "Property Name", "property_name", "Building Name");
          // LXD uses "District" (e.g. "Carlsbad") where Centerpoint uses "CITY"
          const city = pickStr(row, "CITY", "City", "city", "District");
          const propertySize = toInt(pickStr(row, "Property Size", "property_size", "Building Size"));
          const propertyClass = normPropertyClass(pickStr(row, "Property Class", "Class"));
          const propertySubtype = pickStr(row, "Property Subtype", "Subtype");
          const lessor = pickStr(row, "Lessor", "Landlord");
          const tenantAgency = pickStr(row, "Tenant Agency");
          const listingAgency = pickStr(row, "Listing Agency");

          const landlordContactId = lessor ? upsertLandlordContact(lessor, ctx) : null;

          const buildingId = upsertBuilding(
            {
              name: propertyName,
              address,
              city,
              propertyClass,
              propertySubtype,
              propertySizeSf: propertySize,
              landlordName: lessor,
              landlordContactId,
            },
            ctx
          );

          const tenantName = pickStr(row, "Tenant");
          if (!tenantName) {
            stats.rowsSkipped++;
            continue;
          }
          // LXD "Tags" cells often have a `| Complete` data-validation suffix; strip it.
          const industryRaw = pickStr(row, "Tags", "Industry");
          const industry = industryRaw
            ? industryRaw.replace(/\s*\|\s*complete\s*$/i, "").trim() || null
            : null;
          const tenantId = upsertTenantCompany(tenantName, industry);

          const startDate = normDate(row["Signed Date"] ?? row["signed_date"]);
          const endDate = normDate(row["End Date"] ?? row["end_date"]);
          const areaLeased = toInt(pickStr(row, "Area Leased"));
          const floor = pickStr(row, "Floor");
          const suite = pickStr(row, "Suite");
          const transactionType = pickStr(row, "Lease Transaction Type");
          const tenantAgentRaw = pickStr(row, "Tenant Agent(s)");
          const listingAgentRaw = pickStr(row, "Listing Agent(s)");
          const notes = pickStr(row, "Notes");

          // LXD lease economics: $/sf/MONTH → annual $/sf to match CRE convention.
          const baseRentMonthly = toFloat(row["Base Rent Monthly"] ?? row["base_rent_monthly"]);
          const effectiveRentMonthly = toFloat(
            row["Effective Rent - Monthly"] ?? row["effective_rent_monthly"]
          );
          const rentPsf = baseRentMonthly != null ? +(baseRentMonthly * 12).toFixed(4) : null;
          const effectiveRent =
            effectiveRentMonthly != null ? +(effectiveRentMonthly * 12).toFixed(4) : null;
          const annualRent =
            rentPsf != null && areaLeased != null ? Math.round(rentPsf * areaLeased) : null;
          const leaseType = pickStr(row, "Rate Type", "Lease Type");
          const tiAllowance = toFloat(row["TI Allowance"] ?? row["ti_allowance"]);
          const freeRentMonthsRaw = pickStr(row, "Free Rent Months", "free_rent_months");
          const escalationPercent = toFloat(
            row["Escalation Percent"] ?? row["escalation_percent"]
          );
          const isSublease = parseSublease(pickStr(row, "Sublease"));

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
              confidence: "high",
            },
            { tenantId, buildingId, startDate }
          );

          // Tenant decision-makers — Centerpoint only. LXD's "Name (Contact)" is a
          // broker rollup, not decision-makers, so we don't fall back to it.
          const people = splitMultiName(pickStr(row, "Tenant Contact"));
          const emails = splitEmails(pickStr(row, "Email"));
          const phones = parsePhones(pickStr(row, "Contact Information"));

          people.forEach((person, i) => {
            upsertContact(
              {
                name: person.name,
                title: person.title ?? null,
                email: emails[i] ?? null,
                phone: phones.primary,
                directPhone: phones.direct,
                mobilePhone: phones.mobile,
                company: tenantName,
                type: "other",
                tags: ["tenant-contact"],
              },
              ctx
            );
          });

          for (const agent of splitBrokers(tenantAgentRaw)) {
            upsertContact(
              { name: agent, company: tenantAgency, type: "broker", tags: ["tenant-broker"] },
              ctx
            );
          }
          for (const agent of splitBrokers(listingAgentRaw)) {
            upsertContact(
              { name: agent, company: listingAgency, type: "broker", tags: ["listing-broker"] },
              ctx
            );
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

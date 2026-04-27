import { db } from "@/lib/db";
import { buildings, contacts, leases, tenants, uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import {
  countLandlords,
  countTable,
  extractIndustry,
  monthsBetween,
  normDate,
  parseNameCompany,
  pickStr,
  toFloat,
  toInt,
  upsertBuilding,
  upsertContact,
  upsertLandlordContact,
  upsertLease,
  upsertTenantCompany,
  type RowContext,
} from "@/lib/import-helpers";

// Importer for Bob's per-city comp CSVs (Carlsbad, Escondido, Oceanside,
// Rancho Bernardo, San Marcos, Vista). One file per city, ~20-130 rows each.
// Schema (12 columns):
//   Property Size, Signed Date, End Date, Name (Company),
//   Address, City, Market, Submarket, Base Rent Monthly,
//   Space Size, Suite, Notes
// "Name (Company)" is pipe-separated and varies in shape — see parseNameCompany.

type Row = Record<string, unknown>;

// Filename → city mapping for cases where the CSV's City column is blank.
const FILE_CITY_OVERRIDE: Record<string, string> = {
  "rb": "Rancho Bernardo",
};

function cityFromFilename(filename: string): string | null {
  const base = filename
    .replace(/\.csv$/i, "")
    .replace(/\s*comps?\s*$/i, "")
    .trim()
    .toLowerCase();
  return FILE_CITY_OVERRIDE[base] || (base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : null);
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
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const stats = {
      filesProcessed: 0,
      rowsProcessed: 0,
      rowsSkipped: 0,
      buildingsCreated: 0,
      tenantsCreated: 0,
      leasesInserted: 0,
      contactsCreated: 0,
      landlordContactsCreated: 0,
      brokersExtracted: 0,
      vacantListingsSkipped: 0,
      errors: [] as string[],
    };

    const beforeBuildings = countTable(buildings);
    const beforeTenants = countTable(tenants);
    const beforeLeases = countTable(leases);
    const beforeContacts = countTable(contacts);
    const beforeLandlords = countLandlords();

    for (const file of files) {
      const ctx: RowContext = { sourceFile: file.name };
      const filenameCity = cityFromFilename(file.name);

      // xlsx parses CSV when given a string; trims the UTF-8 BOM that the source
      // files happen to carry.
      const text = (await file.text()).replace(/^﻿/, "");
      const wb = XLSX.read(text, { type: "string", cellDates: true, raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        stats.errors.push(`${file.name}: no sheet found`);
        continue;
      }

      const upload = db
        .insert(uploads)
        .values({ filename: file.name, fileType: "excel", status: "processing" })
        .returning()
        .get();

      const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
      stats.filesProcessed++;

      for (const row of rows) {
        try {
          const address = pickStr(row, "Address");
          if (!address) {
            stats.rowsSkipped++;
            continue;
          }

          const entities = parseNameCompany(pickStr(row, "Name (Company)"));
          if (!entities.tenant) {
            // Vacant listing (entity-only or empty) — count and skip; nothing to
            // hang a lease on without a tenant.
            stats.vacantListingsSkipped++;
            stats.rowsSkipped++;
            continue;
          }

          const city = pickStr(row, "City") || filenameCity;
          const submarket = pickStr(row, "Submarket", "Market");
          const propertySize = toInt(pickStr(row, "Property Size"));
          const notes = pickStr(row, "Notes");
          const industry = extractIndustry(notes);

          const lessor = entities.landlord;
          const landlordContactId = lessor ? upsertLandlordContact(lessor, ctx) : null;

          const buildingId = upsertBuilding(
            {
              name: null,
              address,
              city,
              propertyClass: null,
              propertySubtype: null,
              propertySizeSf: propertySize,
              landlordName: lessor,
              landlordContactId,
            },
            ctx
          );

          // Update submarket if blank — buildings table has the field but
          // upsertBuilding doesn't currently fill it.
          if (submarket) {
            const b = db.select().from(buildings).where(eq(buildings.id, buildingId)).get();
            if (b && !b.submarket) {
              db.update(buildings)
                .set({ submarket })
                .where(eq(buildings.id, buildingId))
                .run();
            }
          }

          const tenantId = upsertTenantCompany(entities.tenant, industry);

          const startDate = normDate(row["Signed Date"]);
          const endDate = normDate(row["End Date"]);
          const spaceSize = toInt(pickStr(row, "Space Size"));
          const suite = pickStr(row, "Suite");

          // Per-city CSVs use $/sf/MONTH like the rest of Bob's data.
          const baseRentMonthly = toFloat(row["Base Rent Monthly"]);
          const rentPsf = baseRentMonthly != null ? +(baseRentMonthly * 12).toFixed(4) : null;
          const annualRent =
            rentPsf != null && spaceSize != null ? Math.round(rentPsf * spaceSize) : null;

          let monthsRemaining: number | null = null;
          if (endDate) {
            const end = new Date(endDate);
            const now = new Date();
            if (!isNaN(end.getTime())) monthsRemaining = monthsBetween(now, end);
          }

          // Preserve the raw Name (Company) field in lease notes — the entity
          // classifier is heuristic and Bobby may need to spot-check.
          const leaseNotes = [
            notes,
            entities.raw.length > 1 ? `Entities: ${entities.raw.join(" | ")}` : null,
          ]
            .filter(Boolean)
            .join("\n\n") || null;

          upsertLease(
            {
              tenantId,
              buildingId,
              propertyAddress: address,
              propertyCity: city,
              propertyState: "CA",
              propertyType: "office",
              suiteUnit: suite,
              squareFeet: spaceSize,
              leaseStartDate: startDate,
              leaseEndDate: endDate,
              monthsRemaining,
              rentPsf,
              annualRent,
              tenantAgent: entities.tenantBroker,
              listingAgent: entities.listingBroker,
              notes: leaseNotes,
              sourceFile: ctx.sourceFile,
              confidence: "medium", // entity classification is heuristic
            },
            { tenantId, buildingId, startDate }
          );

          if (entities.tenantBroker) {
            upsertContact(
              {
                name: entities.tenantBroker,
                company: entities.tenantBroker,
                type: "broker",
                tags: ["tenant-broker"],
              },
              ctx
            );
            stats.brokersExtracted++;
          }
          if (entities.listingBroker) {
            upsertContact(
              {
                name: entities.listingBroker,
                company: entities.listingBroker,
                type: "broker",
                tags: ["listing-broker"],
              },
              ctx
            );
            stats.brokersExtracted++;
          }

          stats.rowsProcessed++;
        } catch (err) {
          stats.errors.push(
            `${file.name}: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }

      db.update(uploads)
        .set({ status: "done" })
        .where(eq(uploads.id, upload.id))
        .run();
    }

    stats.buildingsCreated = countTable(buildings) - beforeBuildings;
    stats.tenantsCreated = countTable(tenants) - beforeTenants;
    stats.leasesInserted = countTable(leases) - beforeLeases;
    stats.contactsCreated = countTable(contacts) - beforeContacts;
    stats.landlordContactsCreated = countLandlords() - beforeLandlords;

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

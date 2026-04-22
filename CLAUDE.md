@AGENTS.md

# Bobby BD Dashboard

Business development and prospecting dashboard for a commercial real estate broker named Bobby. Full-stack web app with AI-powered OM parsing, lease-expiration tracking, and deal mapping. The lease-expiration tracker is the core BD value prop — Bobby uses it to prospect tenants whose leases are coming due before competitors do.

## Status (2026-04-22)

**Built and working:** 7 pages, 9-table schema, full CRUD, 8 API routes, Box OAuth flow wired, Claude document-processing pipeline wired.

**Core data flow:** Bobby's Box folder is the OM pipeline. Local Box Drive folder → `watcher/box-watcher.mjs` uploads new PDFs to `/api/process-document` → Claude parses → tenants + leases + property extracted → deal created with address → geocoded → pin on `/map`.

**Why the watcher instead of Box OAuth:** CBRE's enterprise Box would require an admin-approved Custom OAuth App, which is slow or impossible to get. The watcher sidesteps OAuth entirely: Box Drive already syncs the folder to the local filesystem (like Golf BD does with `C:\Users\<user>\Box\CBRE Golf Resort BD`), and the watcher uploads new PDFs to Railway with a shared secret. The Box OAuth API routes (`src/app/api/box/`, `src/lib/api/box.ts`) are kept in place but not used in production — they remain available if CBRE ever clears OAuth.

**Required env vars** (app fully functional only when all set):
- `ANTHROPIC_API_KEY` — OM parsing + lease extraction + enrichment synthesis (headline feature, used everywhere AI shows up)
- `UPLOAD_SECRET` — shared secret the Box watcher must send in `X-Upload-Secret` to upload to `/api/process-document`. Must match the watcher's `UPLOAD_SECRET`.

**Optional env vars (Box OAuth path — kept as fallback):**
- `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL` — only needed if you decide to enable Box OAuth instead of the watcher.

**Research stack** (recommended — powers the `/contacts` enrichment flow):
- `APOLLO_API_KEY` — primary contact enrichment: title, company, phone, verified email, LinkedIn URL. Free tier (~10K credits/mo) covers realistic solo-broker volume.
- `HUNTER_API_KEY` — email verification + find-by-name fallback when Apollo misses. Free tier = 25 searches/mo, paid from $49/mo.
- Pipeline in `src/app/api/enrich-contact/route.ts`: Apollo → Hunter → Claude synthesizes a field-level diff for user approval.

**Not in active use (code present, leave key blank):**
- `APIFY_API_KEY` — LinkedIn profile deep-scraping. Only activates if Apollo returns a LinkedIn URL. Skipped because Apollo already surfaces the LinkedIn URL + basic role data, and the LinkedIn TOS for scraping is gray.

**No key needed:**
- `/map` uses MapLibre GL + CartoDB Dark Matter raster tiles (free, no signup)
- Address geocoding uses the US Census Bureau geocoder (free, no signup, US addresses only)

**Not built yet:** auth (the app is currently wide open).

## Stack

- Next.js **16.2.4** (App Router, Turbopack) + React 19 + TypeScript
- SQLite via `better-sqlite3` + `drizzle-orm` (local at `./data/bobby.db`, Railway at `/data/bobby.db`)
- Tailwind 4 + shadcn/ui components (built on **base-ui** primitives, NOT Radix — see Gotchas)
- Anthropic SDK (`@anthropic-ai/sdk`) — model: `claude-sonnet-4-20250514`
- MapLibre GL JS + CartoDB Dark Matter raster tiles (no token, no signup)
- Deploy: Railway (single service, nixpacks, SQLite volume at `/data`)

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — stat cards, recent activity feed, quick-add contact |
| `/contacts` | CRUD, search/filter, detail+timeline, Excel import, AI enrichment |
| `/deals` | Kanban board (Prospect / Active / Closed / Dead), OM upload, deal detail |
| `/library` | Document library — PDF upload, Claude AI parsing, Box sync |
| `/leases` | **The killer feature.** Time-horizon tabs (6mo/12mo/24mo), tenant+lease data from parsed OMs, CSV export |
| `/activities` | Global timeline feed of calls/emails/meetings/notes |
| `/map` | Mapbox map with deal pins, filters |

## Database Schema (9 tables, `src/lib/db/schema.ts`)

1. `contacts` — people (brokers, prospects, decision-makers). name, email, phone, company, title, type, tags, city/state, notes
2. `deals` — properties in the pipeline. name, property_type, address, asking_price, status, ai_summary, lat/lng
3. `activities` — call/email/meeting/note log, linked to contacts and/or deals
4. `uploads` — Excel imports audit trail
5. `contact_enrichments` — raw JSON from Apollo/Hunter/Apify, one row per enrichment attempt
6. `documents` — uploaded PDFs. box_file_id, filename, status (pending/processing/done/error), document_type, property fields, ai_summary, raw_extracted JSON, deal_id
7. `tenants` — extracted from OMs. name, industry, credit_rating, parent_company, contact info
8. `leases` — extracted from OMs. tenant_id, document_id, deal_id, suite, sqft, start/end dates, months_remaining, rent_psf, annual_rent, lease_type, options, escalations, confidence score
9. `box_config` — OAuth tokens + watched_folders + last_sync_at (single-row config table)

## Local Development

```bash
npm install
cp .env.local.example .env.local   # add your keys
npm run db:migrate                  # creates ./data/bobby.db
npm run db:seed                     # loads sample contacts/deals/activities
npm run dev                         # http://localhost:3000
```

Scripts: `dev`, `build`, `start`, `lint`, `db:migrate`, `db:seed`.

## Key Code Locations

- `src/app/` — routes (App Router)
- `src/app/api/` — route handlers: `activities`, `box`, `contacts`, `deals`, `enrich-contact`, `import-contacts`, `parse-om`, `process-document`
- `src/lib/db/` — `schema.ts`, `migrate.ts`, `index.ts` (connection)
- `src/lib/api/` — external integrations: `anthropic.ts`, `apollo.ts`, `apify.ts`, `box.ts`, `hunter.ts`, `document-processor.ts`
- `src/components/` — feature components (`sidebar`, `deals-board`, `document-library`, `leases-table`, etc.) + `ui/` (shadcn)
- `scripts/seed.ts` — sample data for first-run demo
- `watcher/` — local Box Drive → Railway uploader (`box-watcher.mjs`, `start-watcher.bat`, `README.md`). Runs on Bobby's laptop.

## Railway Deploy

1. New project → deploy from GitHub (`reedlabarcb/bobby-bd-dashboard`)
2. **Add volume mounted at `/data`** — without this, SQLite wipes on every redeploy
3. Env vars: `ANTHROPIC_API_KEY`, `DB_PATH=/data/bobby.db`, `NEXT_PUBLIC_MAPBOX_TOKEN`, optionally the Box + enrichment keys
4. `railway.toml` runs `npx tsx src/lib/db/migrate.ts && npm start` on deploy, healthchecks `/`
5. For Box: after Railway assigns a domain, add `https://<domain>/api/box/callback` to the Box app's allowed redirect URIs and set `BOX_REDIRECT_URI` + `NEXT_PUBLIC_APP_URL` to the Railway URL

## Gotchas (read before writing code)

- **Next.js 16 breaking changes** — per `AGENTS.md`, check `node_modules/next/dist/docs/` before assuming APIs from training data are still valid. `params` is now a `Promise` — must `await`.
- **shadcn/ui is built on base-ui, not Radix.** `Select`'s `onValueChange` signature is `(value: string | null, eventDetails) => void`. `DialogTrigger` uses the `render` prop, not `asChild`. `Button` does **not** have `asChild`.
- **Document processing pipeline:** PDF uploaded → `POST /api/process-document` → Claude extracts tenants + leases + property details → stored with confidence scores in `documents.raw_extracted` (keep this JSON for debugging low-confidence extractions).
- **Box OAuth:** enterprise Box accounts require admin authorization on the Box developer console before tokens work. Personal/free accounts don't.
- **Windows dev:** primary development machine is Windows. Use forward slashes in bash commands; avoid `cat`/`sed`/`grep` — use the Claude Code native tools.

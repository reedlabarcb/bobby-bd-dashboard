@AGENTS.md

# Bobby BD Dashboard

Business development and prospecting dashboard for a commercial real estate broker named Bobby. Full-stack web app with AI-powered OM parsing, lease-expiration tracking, and deal mapping. The lease-expiration tracker is the core BD value prop — Bobby uses it to prospect tenants whose leases are coming due before competitors do.

## Status (2026-04-22)

**Built and working:** 7 pages, 9-table schema, full CRUD, 8 API routes, Box OAuth flow wired, Claude document-processing pipeline wired.

**Gated on env vars** (app runs without them — AI features just show "not configured"):
- `ANTHROPIC_API_KEY` — unlocks OM parsing + lease extraction (**the headline feature**)
- `NEXT_PUBLIC_MAPBOX_TOKEN` — unlocks `/map`
- `BOX_CLIENT_ID` + `BOX_CLIENT_SECRET` — unlocks Box folder sync on `/library`
- `HUNTER_API_KEY`, `APOLLO_API_KEY`, `APIFY_API_KEY` — contact enrichment on `/contacts`

**Not built yet:** auth (the app is currently wide open).

## Stack

- Next.js **16.2.4** (App Router, Turbopack) + React 19 + TypeScript
- SQLite via `better-sqlite3` + `drizzle-orm` (local at `./data/bobby.db`, Railway at `/data/bobby.db`)
- Tailwind 4 + shadcn/ui components (built on **base-ui** primitives, NOT Radix — see Gotchas)
- Anthropic SDK (`@anthropic-ai/sdk`) — model: `claude-sonnet-4-20250514`
- Mapbox GL JS 3
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

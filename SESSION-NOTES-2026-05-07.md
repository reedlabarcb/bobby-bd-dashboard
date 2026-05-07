# Bobby BD Dashboard — Session Updates

**Date:** 2026-05-07
**Branch / commits pushed:** `main` — `17931bc` → `2ccad15` (24 commits)

This is a complete, human-readable summary of every change shipped in this session. It's not a changelog rendering of git messages — it's the full picture of what was built, what was fixed, and what's now possible that wasn't before.

---

## 1. Document-processing pipeline (PDF intake)

### Issues fixed
- **Deprecated Anthropic model.** `claude-sonnet-4-20250514` was returning `not_found_error` on every PDF processed. All 29 PDFs uploaded earlier in the session were stuck with `status='error'`. Updated the model ID to `claude-sonnet-4-6` in both `src/lib/api/anthropic.ts` and `src/lib/api/document-processor.ts`.
- **Truncated Claude JSON responses.** Rent rolls with many tenants generate JSON that exceeds the default 4 000 max_tokens, getting cut off mid-array. `JSON.parse` then failed.
  - Bumped `max_tokens` from 4 000 → 32 000.
  - Wrapped `JSON.parse` with a `jsonrepair` fallback (new dependency: `jsonrepair@3.14.0`). When repair fires, logs `[document-processor] doc <id> JSON repaired (raw=N chars, json=N chars)` and stamps `parsedWithRepair: true` inside `rawExtracted` JSON for audit.
- **SDK refusal of non-streamed long calls.** With `max_tokens=32000` the Anthropic SDK throws `"Streaming is required for operations that may take longer than 10 minutes"`. Switched to `anthropic.beta.messages.stream(...).finalMessage()` so streaming is on by default and large rent rolls finish.
- **Files >10 MB failing the Next.js multipart parser.** Both raw multipart and JSON-base64 paths hit a ~10 MB cap on Railway/Next. Added an **Anthropic Files API** path: the batch script uploads the PDF directly to Anthropic via `anthropic.beta.files.upload()`, then sends `{filename, fileId}` to Railway. The route handler accepts a `DocumentSource` discriminated union (`{kind:"base64"}` or `{kind:"fileId"}`) and threads the right document block + `betas: ["files-api-2025-04-14"]` header through.
- **Apify content-type mismatch.** Files uploaded via `createReadStream` were arriving at Anthropic as `application/octet-stream`. Used the SDK's `toFile(stream, name, {type: "application/pdf"})` helper.
- **Reprocess workflow.** `POST /api/process-document` now reuses any existing pending/error record with the same filename instead of creating duplicates. Library UI got a **Reprocess** button on every error-status doc.

### New `scripts/batch-upload-pdfs.mjs`
Tiered upload script:
- `≤ 8 MB` → multipart FormData (fast path, plays nicely with browsers).
- `8–32 MB` → Anthropic Files API + JSON `{fileId}` to Railway.
- `> 32 MB` → skipped with a clear message (Anthropic's PDF cap).

Also: `dotenv` config now uses `override: true` because the shell had `ANTHROPIC_API_KEY=""` set, which silently blocked the `.env.local` value. Skips only `done` docs (not `error`) so re-runs can recover failed extractions in place.

### Result
The 29-PDF batch that had been stuck at "all error" runs cleanly end-to-end now. Per-file outcomes match expectations (rent rolls + OMs both extract).

---

## 2. Expiring-leases page

- **Lease-end date precision.** `monthsRemaining` was computed by integer month subtraction (`Nov - May = 6`), so a lease ending Nov 13 from today May 7 reported 6 even though it's actually 6.2 months out. Switched to day-precision: `Math.round(diffMs / (1000*60*60*24*30.44))` so labels like "7 mo" don't show on the 6-mo tab.
- **Filter tabs now use exclusive bands.** Previously the 12-mo tab included 6-mo leases (cumulative semantics). Now:
  - **6 mo tab:** 0–6 mo only
  - **12 mo tab:** 6–12 mo only
  - **24 mo tab:** 12–24 mo only
  - **All:** everything
  Stat cards updated to match (cumulative `else if` chain so each lease counts in exactly one bucket).

---

## 3. Theme overhaul

Multiple iterations to land on a usable look:

1. First pass softened the dark theme from near-black `oklch(0.145)` to lighter slate, swapping every hardcoded `bg-zinc-900/60` to theme `bg-card` (25 occurrences across 7 files).
2. Iterated through several dark-slate variants and a "Winter Chill" palette (`#0B2E33` / `#4F7C82` / `#93B1B5` / `#B8E3E9`) at user request.
3. Final state — **white-paper light theme**:
   - Background: `#ffffff`
   - Foreground: `#0f172a` (slate-900)
   - Cards: white with `#e2e8f0` borders
   - Sidebar: `#f8fafc`
   - Primary: blue-600 / Accent chips: `bg-{color}-100` with `text-{color}-600`
   - Muted text: slate-600 (bumped from slate-500 after readability complaint)
4. Sweep across 27 files to replace dark-mode-tuned hardcodes:
   - `text-{color}-400` → `text-{color}-600`
   - `bg-{color}-400/10` → `bg-{color}-100`
   - `text-zinc-*` → `text-slate-*`
   - `bg-zinc-700/800` / `border-zinc-700/800` → `bg-slate-200` / `border-slate-200`

---

## 4. Enrichment pipeline v2 (per-contact)

`POST /api/enrich-contact` now runs five sources in a strict order, with graceful fallback at every stage:

1. **Apollo `/v1/people/search`** (free-tier, name + company). `/organizations/search` runs in parallel to surface the company domain that gets handed to Hunter. Throws a typed `ApolloFreeTierError` on 403 → routes to neutral `notFound` panel instead of breaking the pipeline.
2. **Hunter domain-search** — uses Apollo's discovered domain when available, else company name.
3. **Hunter find-email / verify-email.**
4. **PDL `enrichPerson(name, company)`** — only if Apollo + Hunter still left email/phone blank. Free tier: 100 lookups/month.
5. **Apify `apify~linkedin-profile-scraper`** — only when a LinkedIn URL is on the contact (replaces the dead `anchor~` actor; Proxycurl shut down July 2025).
6. **Claude `synthesizeContactInfo`** — always last, fills blanks only, never overwrites.

Other fixes:
- **Re-enrichment no longer stacks duplicate AI Summary blocks** in `notes`. New blocks replace old.
- "No data from Hunter for this domain" and "Apollo free tier" messages now surface in a neutral `notFound` panel instead of the amber `errors` panel.

### `find-contacts-for-company`
Updated to use the same five-source stack (parallel + deduped by email or name+company). UI badge colors per source: Hunter blue, Apollo violet, PDL emerald, Web amber.

### Lib changes
- `apollo.ts` — rewritten (free-tier endpoints only, `ApolloFreeTierError` class).
- `apify.ts` — typed `ApifyLinkedInResult` mapping, correct actor.
- `pdl.ts` (new, 130 lines) — `enrichPerson`, `enrichCompany`, `searchPeopleAtCompany`.

### Env
- `PDL_API_KEY` added to `.env.local` and to Railway production via the GraphQL `variableUpsert` mutation.
- `.env.local.example` rewritten and force-added past `.env*` ignore — documents all 6 enrichment-related keys with usage notes.

---

## 5. Deep Search workflow (net-new, alongside v2)

This sits next to the v2 pipeline rather than replacing it. v2 = quick. Deep Search = exhaustive, with email-pattern projection.

### `POST /api/deep-search-person`
Inputs: `{ contactId }` or `{ name, company }`. **Does not save to DB.**

Pipeline:
1. Hunter `findEmail` + score
2. PDL `enrichPerson`
3. Apify (only if LinkedIn URL present)
4. Claude `web_search` × 5 queries: `${name} ${company}`, `+ email`, `+ phone`, `+ real estate`, `site:linkedin.com "..."`
5. **Email-pattern projection.** Pool: existing DB contacts at same company/domain + a Hunter domain-search to seed the pattern detector. Run majority-vote on the resulting `(name, email)` pairs. Project missing email, verify with Hunter `verify-email`. Confidence: `"high — pattern + verified"` or `"medium — pattern unverified"`.

Returns a fully populated record plus a 2–3 sentence summary, list of sources used, errors, notFound, and rawFindings dump.

### `POST /api/deep-search-company`
Phase 1 — discover: Hunter domain-search + PDL `searchPeopleAtCompany` + Claude `web_search` × 4.
Phase 2 — project: pool confirmed `(name,email)` pairs from this run + DB. Apply detected pattern to every person without an email. Verify each predicted email with Hunter.

### Email-pattern lib (`src/lib/email-patterns.ts`)
Detects and projects 11 patterns:
`first.last`, `flast`, `f.last`, `first_last`, `first-last`, `firstlast`, `first`, `last`, `last.first`, `lastfirst`, `lastf`.

`chooseMajorityPattern` returns the most-frequent pattern across input pairs and reports `supportCount` so callers can mark `verified` (≥ 2 examples) vs `inferred` (1).

Lookup helper (`src/lib/email-pattern-lookup.ts`) pulls `(name, email)` pairs from the DB by exact-trim company or `@domain` suffix.

### `claude-web-search.ts`
Sequential `web_search` runner. Expects structured JSON. Throws `AnthropicCreditsError` on 400 with `credit_balance`/`balance` substring → routes to `notFound` with `"AI search unavailable — top up credits at console.anthropic.com"` rather than a hard fail. (At session start, MEMORY claimed credits were $0; reality post-fix: credits are funded and successfully ran 16+ streamed PDF extractions plus all enrichment Claude calls.)

### Apollo intentionally not used in deep-search routes
Per session memory, free tier 403s on people-search. Web search replaces it.

### UI
- **`<DeepSearchPersonButton>`** — contact detail page, next to Enrich. Live stage progress (Hunter → PDL → Apify → web → pattern). Preview card with field-level source badges + amber predicted-email block. **Save to Contact** applies blank-only via existing PUT `/api/enrich-contact`.
- **`<DeepSearchCompanyButton>`** — leases-table empty-tenant rows, alongside FindContactsButton. Per-person Add + Add All. Detected email pattern banner at top.
- **`<DeepSearchBulkButton>`** — contacts-table bulk action. **Pre-flight confirmation dialog** showing estimated PDL credit usage so a 50-contact selection doesn't accidentally burn half the monthly free tier. Sequential per contact. Each result has approve/skip toggle; Save All Approved writes via PUT.

### Bug fixes during the deep search workflow
- **Deep search "Failed to apply" save errors.** Web search occasionally returns boolean `true` for a field typed as `string|null`. Without coercion, that truthy non-string flowed all the way to a TEXT column write and SQLite rejected it. Added `asString()` strict coercion guards on both server (deep-search-person route) and client (deep-search-person-button) so a future server bug can't slip through.
- **PDL irrelevant-company hits.** PDL's `job_company_name` term search is loose token overlap, not phrase match — a search for "J&E Bookkeeping" was returning "gigi chang at e-bookkeeping firm". Post-filter requires ≥ 50% non-stop-word token overlap between the searched company and each result's `job_company_name`. Stop-words list excludes generic suffixes (LLC, Corp, Group, Firm…). Tokenizer keeps brand abbreviations intact: split on whitespace only, then strip punctuation **inside** tokens — so "J&E" → `je` (single token) instead of `j` + `e` (both filtered as length-1).

---

## 6. Find People UX upgrades

The Find People modal (FindContactsButton) now lets the user **deep-research a candidate before adding them**:

- Each candidate row has two stacked buttons: outlined `Deep Research` on top, primary `Add` below.
- Click Deep Research → fires `/api/deep-search-person` for that name + company → inline panel renders under the row showing summary, predicted email (amber), city/state, with a purple "Deep enriched" badge.
- The subsequent Add merges the enriched fields (title, email, phone, city, state, LinkedIn, predicted-email-note) before POSTing to `/api/contacts`.
- Re-research overwrites the inline panel.

---

## 7. Contacts page default view

Default view is now `?view=company` (was `flat`). Companies are the primary index — click a company header to expand into the people there. `?view=flat` URL still works for the old people-first table.

---

## 8. Full edit & delete on every resource

Every major table now has a per-row **edit + delete** action, with the change persisting immediately through the proper REST endpoint.

### New per-id REST endpoints
PUT (update) + DELETE (remove) handlers were missing on most resources. Added:
- `src/app/api/leases/[id]/route.ts`
- `src/app/api/buildings/[id]/route.ts`
- `src/app/api/tenants/[id]/route.ts`
- `src/app/api/documents/[id]/route.ts`
- `src/app/api/activities/[id]/route.ts`

(`contacts/[id]` and `deals/[id]` already existed and were left as-is.)

### `<GenericEditDialog>`
Schema-driven dialog used by every table. Field types: `text`, `number`, `textarea`, `date`, `select`. Builds a typed payload (numbers parsed, blanks coerced to `null`), calls PUT or DELETE on whichever endpoint the caller passes in. Delete button is gated behind a confirm sub-dialog that previews what's about to be removed.

### Wired in
| Page | Edit affordance | Editable fields |
|---|---|---|
| **Contacts** (company view) | Pencil per person | name, type, title, company, email, phone, city, state, tags, notes |
| **Contacts** (flat view) | Bulk delete in action bar | (delete only) |
| **Leases** | Pencil at end of each row | property name/address/city/state/type, suite, sqft, lease start/end dates, rent psf, annual rent, lease type, options, escalations, confidence |
| **Buildings** | Pencil at end of each row | name, address, city, state, submarket, district, class, subtype, total SF, landlord, notes |
| **Documents** | "Edit / Delete" button in expanded card | filename, doc type, status, property fields, asking price, AI summary, error message |
| **Activities** | Pencil icon next to timestamp | type, subject, body, date |
| **Deals** | (Existing) | (existing) |
| **Tenants** | API ready, UI not yet wired | — |

### Bulk delete on contacts
Contacts-table action bar (which already had Deep Search) now also has a red `Delete (N)` button that confirms then sequentially DELETEs each selected ID. Selection clears on completion.

### `<ContactEditDialog>`
Bespoke version of the generic dialog for contacts (richer than the generic version because the type field is constrained to the schema's enum and the route is `PUT /api/contacts/[id]`).

---

## 9. Memory / docs

Two new memory reference files:
- `reference-enrichment-pipeline.md` — v2 stack details
- `reference-deep-search.md` — Deep Search workflow details

Index in `MEMORY.md` updated with pointer lines.

---

## Files added this session
- `src/lib/api/pdl.ts`
- `src/lib/api/claude-web-search.ts`
- `src/lib/email-patterns.ts`
- `src/lib/email-pattern-lookup.ts`
- `src/app/api/deep-search-person/route.ts`
- `src/app/api/deep-search-company/route.ts`
- `src/app/api/leases/[id]/route.ts`
- `src/app/api/buildings/[id]/route.ts`
- `src/app/api/tenants/[id]/route.ts`
- `src/app/api/documents/[id]/route.ts`
- `src/app/api/activities/[id]/route.ts`
- `src/components/find-contacts-button.tsx`
- `src/components/deep-search-person-button.tsx`
- `src/components/deep-search-company-button.tsx`
- `src/components/deep-search-bulk-button.tsx`
- `src/components/contact-edit-dialog.tsx`
- `src/components/generic-edit-dialog.tsx`
- `scripts/batch-upload-pdfs.mjs`
- `.env.local.example` (rewritten, force-added)

## Files modified
~30 files including `globals.css`, `layout.tsx`, every table component, `enrich-contact/route.ts`, `process-document/route.ts`, both Anthropic SDK wrappers, and the contacts/leases/library page surfaces.

---

## Known gaps / next-up

1. **`APIFY_API_KEY` not set** on Railway. Without it both v2 enrichment and deep-search-person silently skip the LinkedIn scrape step. Setting the key unlocks high-quality title/location data.
2. **Tenants don't have an edit UI** yet (the API is ready). Tenants currently render only inside the buildings drilldown panel — could add a pencil there.
3. **Hunter rate limits on free tier** — bulk Deep Search makes ≥ 5 Hunter calls per contact (find-email, verify-email, domain-search, plus per-predicted-email verifies). Caching `verify-email` results by email for 24 h would slash usage on repeat runs.
4. **Apollo paid path** still locked. If Bobby ever moves to a paid Apollo plan, the `/people/search` calls already in place will start returning real data instead of 403; nothing else needs to change.
5. **`tenants/[id]` UI wiring** pending if you want pencil edits on tenants directly.

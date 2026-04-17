# Bobby BD Dashboard

Business Development & Prospecting Dashboard for commercial real estate brokers.

## Stack

- Next.js 16 (App Router) + TypeScript
- SQLite + Drizzle ORM
- Tailwind CSS + shadcn/ui
- Claude AI (OM parsing, contact enrichment)
- Mapbox GL JS (deal map visualization)

## Local Setup

```bash
# Install dependencies
npm install

# Copy env file and add your API keys
cp .env.local.example .env.local

# Run database migration
npm run db:migrate

# Seed with sample data
npm run db:seed

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | OM parsing, AI summaries | For AI features |
| `HUNTER_API_KEY` | Email finder/verification | For enrichment |
| `APOLLO_API_KEY` | Contact enrichment | For enrichment |
| `APIFY_API_KEY` | LinkedIn/web scraping | For enrichment |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Map visualization | For map page |
| `DB_PATH` | SQLite database path | No (defaults to ./data/bobby.db) |

The app works without any API keys — AI features will show "not configured" messages gracefully.

## Railway Deployment

1. Create a new Railway project
2. Add a **Volume** mounted at `/data`
3. Connect your GitHub repo
4. Set environment variables:
   - `DB_PATH=/data/bobby.db`
   - `ANTHROPIC_API_KEY=sk-ant-...`
   - `NEXT_PUBLIC_MAPBOX_TOKEN=pk....`
   - (optional) `HUNTER_API_KEY`, `APOLLO_API_KEY`, `APIFY_API_KEY`
5. Deploy — Railway will auto-detect `railway.toml` for build/start config

The `railway.toml` handles:
- Running DB migrations on deploy
- Health check on `/`
- Auto-restart on failure

## Features

- **Dashboard** — Stats, recent activity, quick actions
- **Contacts** — CRUD, search/filter, Excel import, AI enrichment pipeline
- **Deals** — OM upload with AI parsing, status pipeline, geocoding
- **Activities** — Global activity feed with timeline
- **Map** — Interactive Mapbox map with deal pins, filters, heatmap

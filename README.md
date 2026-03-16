# Wein-Ticker

Next.js + Supabase + API-first scraper (with Playwright fallback) for tracking Denner wine prices.

## 1) Setup

1. Install Node 20.
2. Install dependencies:
   - `npm install`
3. Copy env template:
   - `cp .env.example .env.local` (PowerShell: `Copy-Item .env.example .env.local`)
4. Fill Supabase values in `.env.local`.
5. Add optional values for Step 2 flows:
   - `APP_BASE_URL=http://localhost:3000`
   - `TRACKING_TOKEN_SECRET=any-long-random-string`
   - `RESEND_API_KEY=...` (optional for local; without it, verify link preview is returned by API)
   - `CRON_SECRET=...` (optional, used by `/api/notify`)
   - `SCRAPER_MAX_PRODUCTS=50` (optional, useful for quick test runs)

## 2) Run app

- `npm run dev`

## 3) Run scraper

- `npm run scrape:wines`

Before first v2 scrape, run SQL migration:

- `supabase/migrations/20260313_scraper_v2_wines_fields.sql`
- `supabase/migrations/20260313_job_runs_monitoring.sql`
- `supabase/migrations/20260313_notification_dedupe.sql`
- `supabase/migrations/20260313_wine_price_history.sql`

The scraper uses:

- `https://www.denner.ch/sitemap.product.xml` for wine URL discovery
- `https://www.denner.ch/api/product/{id}?locale=de` for structured product data
- Playwright as per-item fallback only when API extraction fails

Pricing semantics:

- `current_price` / `base_price`: bottle-level prices
- `case_price` / `case_base_price`: case-level prices
- each scraper run also writes snapshots to `wine_price_history` for historical trend tracking

## Monitoring

- Health endpoint:
  - `GET /api/health`
  - returns DB connectivity, wine count, and latest `last_scraped_at`
- Monitoring overview endpoint:
  - `GET /api/monitoring/overview`
  - protected with `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set
  - returns wine stats and recent `job_runs`
- Job run logging:
  - scraper writes `scrape_wines` runs into `job_runs`
  - notification route writes `notify_sales` runs into `job_runs`

## Price History API

- Endpoint:
  - `GET /api/wines/{id}/history`
- Query params:
  - `limit` (optional, default `50`, max `500`)
- Response:
  - current wine snapshot (`wine`)
  - historical points from `wine_price_history` (`points`)

## Implemented in Step 1

- Project initialization (Next.js 14 App Router + Tailwind + TypeScript)
- Supabase public/admin clients
- Env validation (`lib/env.ts`)
- Idempotent wine upsert service (`lib/wines/upsert.ts`)
- Standalone scraper (`scripts/scrape-denner-wines.ts`)
- Minimal homepage with wine search over `wines`

## Implemented in Step 2

- `POST /api/subscribe`
- `GET /api/verify?token=...`
- `POST /api/unsubscribe`
- `POST /api/notify` (optional `Authorization: Bearer <CRON_SECRET>`)
- `/my-trackings/[token]` overview page
- Notification dedupe:
  - no repeated sale email for unchanged price state
  - sends again only when sale price state changes

## Local Test Flow (without Resend)

1. Start app: `npm run dev`
2. Open `http://localhost:3000`
3. Select a wine and submit email
4. Copy `verifyUrlPreview` from the UI and open it in browser
5. You are redirected to `/my-trackings/[token]`
6. Test unsubscribe button

## Backlog: Catalog Count Alignment

- Current state: local dataset count can be lower than Denner webshop filter counters.
- Example observed:
  - Local DB (after v2 scrape): `490`
  - Denner filter sum (sample): `~518`
- Known likely causes:
  - strict filter `availability.forSale = true`
  - strict deduplication on `denner_product_id`
  - incomplete wine type mapping (`wine_type = null` for a subset)
- Future task:
  - add a dedicated "count alignment mode" for diagnostics
  - compare by `denner_product_id` against Denner source counts
  - decide whether to relax filters/dedup or keep current stricter quality rules

# Wein-Ticker: Session Handoff

This file captures the current functional and deployment state so the next session can continue without context loss.

## Current Status (Done)

- Production deployment is live on Vercel.
- Production branch is `master`.
- Supabase production migrations are applied:
  1. `20260313_scraper_v2_wines_fields.sql`
  2. `20260313_job_runs_monitoring.sql`
  3. `20260313_notification_dedupe.sql`
  4. `20260313_wine_price_history.sql`
- Production API checks passed:
  - `GET /api/health` returns `ok: true`
  - `GET /api/monitoring/overview` (Bearer `CRON_SECRET`) returns fresh `job_runs`
- Fresh production runs confirmed on March 16, 2026:
  - `scrape_wines` run `ok`
  - `notify_sales` run `ok`
  - `last_scraped_at` updated to March 16, 2026
- New cron-driven scrape endpoint implemented:
  - `GET /api/scrape` (Bearer `CRON_SECRET` when set)
  - uses API-first scrape mode in serverless (`useFallback: false`)
- Vercel cron configured (`vercel.json`, UTC):
  - `/api/scrape` at `05:05`
  - `/api/notify` at `05:20`
- Dynamic/no-cache behavior enforced for:
  - `/api/health`
  - `/api/monitoring/overview`
- Lint/typecheck/tests are green in repo.

## Latest Session Updates (March 16, 2026)

1. Otto's adapter now uses product detail enrichment (`/occ/v2/ottos/products/{code}?fields=FULL`):
   - better extraction for `country`, `region`, `vintage_year`, `wine_type`, `bottle_volume_cl`, `case_size`, `image_url`
2. Otto's sale detection improved:
   - still uses price comparison when available
   - additionally marks as on-sale when promo tag is present (e.g. `promoted`)
3. Denner artifact protection added in scraper:
   - suspicious rows are dropped when:
     - metadata is fully unknown (`wine_type/country/region/vintage_year` all null)
     - row has no case fields
     - `current_price` exactly matches a known case price for same normalized name
4. Production cleanup executed:
   - bulk deletion of historical Denner case-price artifacts completed
   - 18 invalid offer rows removed
5. Canonical race-condition fix deployed:
   - canonical creation now conflict-tolerant (`upsert` on `canonical_key`)
   - prevents intermittent `duplicate key` failures during scrape
6. Homepage search consistency fix deployed:
   - stable paging order (`name` + `id`)
   - row deduplication by offer `id`
   - resolved phantom duplicate entries in UI despite correct DB state
7. Cron auth hardening deployed:
   - `/api/scrape`, `/api/notify`, and `/api/monitoring/overview` accept both:
     - `Authorization: Bearer <CRON_SECRET>`
     - `x-cron-secret: <CRON_SECRET>`
   - preferred standard for manual tests: `x-cron-secret`

## Current Direction (New Workstream)

- Multi-shop expansion approved:
  - add Otto's as second source
  - keep Denner source
- New target model:
  - `canonical_wines` (shop-agnostic identity)
  - `wine_offers` (shop-specific offers)
- UX target:
  - search shows source shop labels
  - user can track same wine from multiple shops independently
- Scraper target:
  - adapter architecture per shop
  - per-shop failure isolation (one shop failing does not block others)

## Useful Production Endpoints

- App base URL:
  - `https://wein-tracker-vercel.vercel.app`
- Health:
  - `GET /api/health`
- Monitoring overview:
  - `GET /api/monitoring/overview` (Bearer `CRON_SECRET`)
- Trigger scrape:
  - `GET /api/scrape` (Bearer `CRON_SECRET`)
- Trigger notify:
  - `POST /api/notify` (Bearer `CRON_SECRET`)
- Wine history example:
  - `GET /api/wines/{id}/history?limit=50`

## Git State

- Repository initialized and connected to GitHub.
- Remote:
  - `https://github.com/klausuhr/wein-tracker.git`
- Recent rollout commits include:
  - API route dynamic fixes
  - test suite setup (Vitest)
  - CI workflow
  - `/api/scrape` endpoint + `vercel.json` crons
  - no-cache fix for health/monitoring
- Remote:
  - `https://github.com/klausuhr/wein-tracker.git`

## Next Session Plan

1. Introduce `staging` as mandatory rollout gate for new shop changes (no direct prod-first schema/runtime changes).
2. Add and use per-shop feature flags in production (deploy dark, enable later).
3. Add a standard release gate checklist:
   - lint, typecheck, tests
   - SQL data quality checks
   - manual scrape + notify smoke
4. Standardize job API contract (`/api/scrape` and `/api/notify`) to same method/auth pattern.
5. Continue operational work:
   - custom app domain
   - sender domain / DNS for mail deliverability
6. Subscription UX improvement (planned):
   - one-time email verification per address
   - new offer subscriptions for already verified emails should activate without repeated verification mail

## Notes / Decisions

- Denner promo cadence update from user:
  - promotions now run Thursday to Wednesday.
- History table behavior:
  - `wine_price_history` starts from when history writes were active in this environment.
  - Older snapshots are not auto-backfilled unless a dedicated backfill is run.

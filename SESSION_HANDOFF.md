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

1. Add migration for multi-shop schema (`canonical_wines`, `wine_offers`, `subscriptions.offer_id`).
2. Refactor scraper to adapter-orchestrator and add Otto's adapter.
3. Switch subscribe/notify/tracking flow from `wine_id` to `offer_id` (compat window).
4. Update search UI to show shop source and allow tracking both offers.
5. Verify production smoke tests for Denner + Otto's runs.
6. After core is stable: continue with custom domain + sender domain work.

## Notes / Decisions

- Denner promo cadence update from user:
  - promotions now run Thursday to Wednesday.
- History table behavior:
  - `wine_price_history` starts from when history writes were active in this environment.
  - Older snapshots are not auto-backfilled unless a dedicated backfill is run.

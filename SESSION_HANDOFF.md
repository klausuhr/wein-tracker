# Wein-Ticker: Session Handoff

This file captures the current functional state so we can continue tomorrow without context loss.

## Current Status (Done)

- Next.js app, Supabase integration, and Resend email flows are implemented.
- Subscription flow works end-to-end:
  - subscribe
  - verify
  - my-trackings
  - unsubscribe
- Scraper v2 is implemented and working:
  - API-first (`sitemap.product.xml` + `api/product/{id}`)
  - Playwright fallback per failed item
  - bottle and case pricing separation
  - metadata mapping (type/country/region/vintage where available)
- Monitoring implemented:
  - `GET /api/health`
  - `GET /api/monitoring/overview` (Bearer `CRON_SECRET`)
  - `job_runs` logging for scraper + notify
- Notification dedupe implemented:
  - repeated unchanged sale notifications are skipped
- Price history implemented:
  - snapshots written to `wine_price_history` on each scrape run
  - endpoint: `GET /api/wines/{id}/history?limit=...`
- UI improved:
  - better visual design
  - richer wine info in search and trackings
  - autocomplete closes on outside click
  - `Esc` closes dropdown
  - clearing input resets selected wine

## Important Migrations

Run these in Supabase SQL Editor (if not already done in target environment):

1. `supabase/migrations/20260313_scraper_v2_wines_fields.sql`
2. `supabase/migrations/20260313_job_runs_monitoring.sql`
3. `supabase/migrations/20260313_notification_dedupe.sql`
4. `supabase/migrations/20260313_wine_price_history.sql`

## Local Verify Commands

```powershell
cd "C:\Users\info\OneDrive\Desktop\Wein Tracker"
npm run dev
```

In another terminal:

```powershell
cd "C:\Users\info\OneDrive\Desktop\Wein Tracker"
npm run scrape:wines
```

Notify test:

```powershell
$secretLine = Get-Content .env.local | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
$secret = $secretLine -replace '^CRON_SECRET=', ''
$headers = @{ Authorization = "Bearer $secret" }
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/notify" -Headers $headers
```

## Useful Endpoints

- Health: `http://localhost:3000/api/health`
- Monitoring overview: `http://localhost:3000/api/monitoring/overview`
  - requires Bearer `CRON_SECRET` if configured
- Wine history example:
  - `http://localhost:3000/api/wines/ea2b5bb6-ee18-4fb9-b06b-dd7b9ec5d88b/history`

## Git State

- Repository initialized
- Initial commit exists on `main`
- Current working tree includes uncommitted local changes for:
  - price history endpoint and migration
  - scraper and README updates
  - this handoff file
- Remote:
  - `https://github.com/klausuhr/wein-tracker.git`

## Deployment Plan (Next Session)

1. Create/connect Vercel project to GitHub repo.
2. Prepare/confirm production Supabase project.
3. Run all migrations on production Supabase.
4. Set Vercel environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_BASE_URL`
   - `TRACKING_TOKEN_SECRET`
   - `RESEND_API_KEY`
   - `CRON_SECRET`
   - optional: `SCRAPER_HEADLESS`, `SCRAPER_TIMEOUT_MS`
5. Deploy on Vercel.
6. Run production smoke tests:
   - subscribe/verify/trackings
   - `/api/health`
   - `/api/monitoring/overview`
7. Trigger one production scrape and one notify run.
8. Set up scheduled jobs (scrape + notify).

## Note for Tomorrow

If anything appears missing in UI, first force refresh and ensure:
- `npm run dev` is running
- latest commit is pulled
- migrations are applied in the environment being tested

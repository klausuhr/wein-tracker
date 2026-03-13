# 05 Integration Spec

## Required Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SCRAPER_HEADLESS` (default `true`)
- `SCRAPER_TIMEOUT_MS` (default `45000`)
- `RESEND_API_KEY` (required when email flows are implemented)
- `APP_BASE_URL` (required when building absolute email links)

## Supabase Client Integration

- Browser client:
  - Uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Read-focused operations for public UI data
- Server/admin client:
  - Uses `SUPABASE_SERVICE_ROLE_KEY`
  - Used by scripts and privileged API routes
- Rule: never expose service role key to browser bundles.

## Resend Integration

- Email sending is done from server-side code only.
- Minimum email templates:
  - verification email
  - sale alert email
- Sending contract:
  - validation before send
  - structured error logging with email type and target domain

## Denner Scraping Integration

- Primary sources:
  - `https://www.denner.ch/sitemap.product.xml` for product URL discovery
  - `https://www.denner.ch/api/product/{id}?locale=de` for structured product details
- Fallback source:
  - Playwright detail-page extraction for product-level API failures only
- Discovery rules:
  - include only URLs under `/de/weinshop/`
  - derive stable product id from URL suffix (`~p...`) or remote id mapping
- Product scope:
  - keep only products where `availability.forSale = true`
- Price mapping contract:
  - bottle current/base from `sales.priceSingleUnit`
  - case current/base from `sales.price`
- Anti-fragility:
  - API failure on one item must not fail whole run
  - fallback failure on one item must not fail whole run
  - run-level failures return non-zero exit code only when no meaningful dataset can be produced

## API Integration Contracts (Planned)

- `POST /api/subscribe`:
  - input: `email`, `wineId`
  - output: accepted status (without leaking sensitive internals)
- `GET /api/verify?token=...`:
  - validates token and confirms subscription
- Notification entrypoint:
  - route or script callable by cron

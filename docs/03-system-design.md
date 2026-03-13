# 03 System Design

## Architecture Overview

- Frontend: Next.js App Router pages and components
- API: Next.js Route Handlers for subscribe, verify, notify, unsubscribe
- Data: Supabase PostgreSQL
- External integrations:
  - Denner sitemap + product detail API (primary)
  - Denner website via Playwright fallback (secondary)
  - Resend for transactional emails

## Module Boundaries

- `app/*`: UI routes and API routes only
- `lib/supabase/*`: client factories and database access helpers
- `lib/domain/*`: business rules (sale logic, token handling, validation)
- `lib/email/*`: Resend integration and templates
- `scripts/*`: standalone jobs (scraper, later notification job wrapper)

## Data Flows

### Scrape -> Upsert

1. Script loads Denner product sitemap and discovers wine product URLs.
2. Script extracts product ids and fetches product details via Denner API.
3. Script normalizes fields including bottle/case prices and wine metadata.
4. Script filters to buyable products only.
5. Script attempts Playwright fallback for product-level API failures.
6. Script computes sale status from per-bottle price semantics.
7. Script upserts batches into Supabase `wines`.
8. Script logs source-level and fallback-level run summary.

### Subscribe -> Verify

1. User submits email + selected wine.
2. API validates inputs and inserts unconfirmed subscription with token.
3. Email service sends verification link.
4. User opens verification link.
5. Verify API marks subscription confirmed.

### Notify Run

1. Job queries confirmed subscriptions joined with wines.
2. Filters for wines currently on sale.
3. Sends alert emails.
4. Logs sent/failed counts.

## Error Strategy

- Input validation errors: return `400`.
- Missing resources/token not found: `404`.
- External service failures (Supabase, Resend, Denner API, Playwright): log and return `500` (API) or exit code `1` (scripts).
- Product-level API failures in scraper: log and continue with per-item fallback.
- Product-level fallback failures: log and continue when minimum threshold is still met.

## Design Principles

- Keep business logic in `lib/domain` and out of UI/route handlers.
- Keep source adapters isolated:
  - API adapter for primary extraction
  - Playwright adapter for fallback extraction
- Ensure all external calls are explicit and easy to mock in tests.

# 03 System Design

## Architecture Overview

- Frontend: Next.js App Router pages and components
- API: Next.js Route Handlers for subscribe, verify, notify, unsubscribe
- Data: Supabase PostgreSQL
- External integrations:
  - Denner sitemap + product detail API
  - Otto's OCC product search API
  - optional shop-specific browser fallback adapters
  - Resend for transactional emails

## Module Boundaries

- `app/*`: UI routes and API routes only
- `lib/supabase/*`: client factories and database access helpers
- `lib/domain/*`: business rules (sale logic, token handling, validation)
- `lib/email/*`: Resend integration and templates
- `lib/scraper/*`: source adapters + normalization + matching
- `scripts/*`: orchestration jobs (multi-shop scrape, maintenance scripts)

## Data Flows

### Scrape -> Upsert (Multi-Shop)

1. Orchestrator executes one adapter run per shop (`denner`, `ottos`, ...).
2. Each adapter emits normalized `ScrapedOffer` rows with source identity.
3. Offers are matched to canonical wines using heuristic matching.
4. Canonical + offers are upserted idempotently.
5. Price snapshots are written to history with source references.
6. Per-shop run summary is logged.
7. Failures are isolated:
   - one shop can fail while other shops continue and persist.
8. Final job status is aggregated (`ok`, `partial`, `failed`).

### Subscribe -> Verify

1. User submits email + selected offer.
2. API validates inputs and inserts unconfirmed subscription with token.
3. Email service sends verification link.
4. User opens verification link.
5. Verify API marks subscription confirmed.

### Notify Run

1. Job queries confirmed subscriptions joined with `wine_offers` and `canonical_wines`.
2. Filters for offers currently on sale.
3. Sends alert emails.
4. Logs sent/failed counts.

## Error Strategy

- Input validation errors: return `400`.
- Missing resources/token not found: `404`.
- External service failures (Supabase, Resend, source APIs, browser fallback): log and return `500` (API) or exit code `1` (scripts).
- Shop-level scraper failures: isolated and logged without blocking other shops.
- Product-level failures: logged and skipped unless critical threshold is hit.

## Design Principles

- Keep business logic in `lib/domain` and out of UI/route handlers.
- Keep source adapters isolated behind one contract:
  - one adapter per shop
  - shared normalized output contract
  - shared upsert/matching pipeline
- Preserve source traceability on all offer and history rows (`shop`, source id, URL).
- Ensure all external calls are explicit and easy to mock in tests.

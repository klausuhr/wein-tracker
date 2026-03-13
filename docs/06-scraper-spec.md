# 06 Scraper Specification

## Purpose

Populate and refresh the `wines` table from Denner wine shop with idempotent upserts.

## Entry Point

- Script location: `scripts/scrape-denner-wines.ts`
- npm command: `npm run scrape:wines`

## Runtime Behavior

1. Validate required env vars.
2. Load Denner product sitemap and extract product URLs.
3. Filter URLs to `/de/weinshop/` and deduplicate.
4. Derive product ids and fetch product details from Denner product API.
5. Normalize and validate API records.
6. Keep only buyable products (`availability.forSale=true`).
7. For API failures, run Playwright fallback extraction per failed item.
8. Merge API + fallback records and deduplicate by `slug`.
9. Upsert in batches into Supabase.
10. Emit run summary and exit.

## Extracted Fields

- `name`: product title
- `slug`: from product URL segment; fallback slugify from name
- `denner_product_id`: stable product id
- `source_url`: canonical product URL
- `image_url`: product image source
- `current_price`: bottle current price
- `base_price`: bottle previous price (`instead`)
- `case_price`: case current price
- `case_base_price`: case previous price (`instead`)
- `wine_type`, `country`, `region`, `vintage_year`
- `category_path`, `bottle_volume_cl`, `case_size`
- `last_scraped_at`: set to current UTC timestamp at write time

## Parsing and Validation Rules

- Skip records missing `name`, `slug`, `denner_product_id`, or bottle `current_price`.
- Accept `base_price`, `case_price`, and `case_base_price` as nullable.
- Convert all prices to decimal numbers.
- `current_price` must always represent bottle price.
- Compute `is_on_sale` from bottle price contract.
- Parse metadata from structured API first, fallback only if API missing.

## Reliability Rules

- Sitemap/API request retry: max 2 retries with backoff.
- Product API errors: log and continue.
- Playwright fallback errors: log and continue.
- DB write failure: fail run with exit code `1`.
- Empty extraction:
  - treat as failure unless a clear no-results condition is detected.

## Logging Schema

- `run_started` with timestamp and config (`headless`, timeout)
- `sitemap_loaded` with discovered URL count
- `api_fetched` with success/fail counts
- `fallback_fetched` with success/fail counts
- `products_valid` with valid/skipped counts and buyable-filtered count
- `db_upsert_completed` with inserted/updated estimate
- `run_finished` with duration and exit status

## Exit Codes

- `0`: successful run (including partial product skips)
- `1`: fatal failure (navigation unrecoverable, env invalid, DB failure)

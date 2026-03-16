# 06 Scraper Specification

## Purpose

Populate and refresh multi-shop wine offers with idempotent upserts and canonical matching.

## Entry Point

- Script location: `scripts/scrape-denner-wines.ts`
- npm command: `npm run scrape:wines`

## Runtime Behavior

1. Validate required env vars.
2. Execute one adapter run per enabled shop.
3. Normalize each source row into shared `ScrapedOffer` contract.
4. Resolve canonical wine identity via matching contract.
5. Upsert canonical wines and shop offers in batches.
6. Write offer-level price history snapshots.
7. Emit per-shop and aggregate run summary (`ok` / `partial` / `failed`).

## Extracted Fields

- `shop`: source shop id (`denner`, `ottos`, ...)
- `shop_product_id`: stable source product id
- `source_url`: canonical product URL
- `name`: source-facing product title
- `image_url`: product image source
- `current_price`: bottle current price
- `base_price`: bottle previous price (`instead`)
- `case_price`: case current price
- `case_base_price`: case previous price (`instead`)
- `wine_type`, `country`, `region`, `vintage_year`
- `category_path`, `bottle_volume_cl`, `case_size`
- `last_scraped_at`: set to current UTC timestamp at write time
- canonical matching hints:
  - normalized name key
  - country
  - vintage
  - bottle volume

## Parsing and Validation Rules

- Skip records missing `name`, `slug`, `denner_product_id`, or bottle `current_price`.
- Accept `base_price`, `case_price`, and `case_base_price` as nullable.
- Convert all prices to decimal numbers.
- `current_price` must always represent bottle price.
- Compute `is_on_sale` from bottle price contract.
- Parse metadata from structured API first, fallback only if API missing.

## Adapter Sources

- Denner:
  - sitemap + product API
  - optional per-item browser fallback
- Otto's:
  - OCC search API:
    - `GET /occ/v2/ottos/products/search`
    - query style: `::allCategories:m_10400`
    - paginated with `currentPage` and `pageSize`

## Reliability Rules

- Source request retry: max 2 retries with backoff.
- Product-level mapping failures: log and skip.
- Shop-level failures: log and continue with other shops.
- DB write failure: fail run with exit code `1`.
- Aggregate run status:
  - `ok`: all shops successful
  - `partial`: at least one shop failed, at least one shop succeeded
  - `failed`: all enabled shops failed

## Logging Schema

- `run_started` with timestamp and config (`headless`, timeout)
- `shop_started` with shop id
- `shop_completed` with discovered/selected/valid/upsert/history counts
- `shop_failed` with shop id and error
- `db_upsert_completed` with offer/canonical write summary
- `run_finished` with duration and exit status

## Exit Codes

- `0`: successful run (including partial product skips)
- `1`: fatal failure (env invalid, DB failure, or all enabled shops failed)

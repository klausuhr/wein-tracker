# 02 Product Requirements

## Product Goal

Allow users to track wine prices from Denner and get email alerts when selected wines are on sale.

## Core Workflows

1. Scrape Denner wine shop and update `wines`.
2. User selects a wine on landing page and submits email.
3. System creates unconfirmed subscription and sends verification email.
4. User verifies via `/api/verify?token=...`.
5. Notification job sends sale alert emails to confirmed subscriptions.
6. User opens `/my-trackings/[token]` and can unsubscribe.

## Functional Requirements

### FR-1 Scraper

- Build a full wine catalog from Denner product sitemap + product detail API.
- Include only currently buyable products (`availability.forSale = true`).
- Extract wine name, image URL, stable slug, and stable Denner product id.
- Extract pricing with explicit semantics:
  - `current_price` = per-bottle current price
  - `base_price` = per-bottle previous price (if available)
  - `case_price` = case/pack current price (if available)
  - `case_base_price` = case/pack previous price (if available)
- Extract metadata: wine type/category, country, region, vintage year.
- Upsert into `wines` table by unique `slug`.
- Update `last_scraped_at` for each processed wine.

### FR-2 Landing and Search

- Landing page must expose search/autocomplete over existing `wines`.
- User can select one wine and submit an email to track it.

### FR-3 Double Opt-In

- On submit, create `subscriptions` row with `is_confirmed=false`.
- Generate `confirmation_token`.
- Send verification email containing verification URL.
- Verification endpoint sets `is_confirmed=true` for valid token.

### FR-4 Notification Engine

- Read subscriptions joined with wines.
- Send alert only when:
  - subscription is confirmed, and
  - wine is on sale.
- Email includes wine name and per-bottle price comparison.
- Case-price information may be included as secondary context when available.

### FR-5 Tracking Overview

- Route `/my-trackings/[token]` lists tracked wines for a user token.
- User can unsubscribe from individual tracked wines.

## Non-Functional Requirements

- Reliability: scraper handles product-level API failures without full run failure.
- Idempotency: reruns must not create duplicate wines.
- Security: service-role key only on server/job context.
- Observability: each job run emits summary logs and failure reasons.
- Maintainability: strict separation between source adapters (API / fallback) and persistence logic.

## Acceptance Criteria

1. Running scraper populates `wines` with more than teaser-only volume (full catalog behavior).
2. Re-running scraper updates existing rows, does not duplicate.
3. Per-bottle and case pricing are both stored with correct semantics.
4. Country, region, wine type, and vintage are persisted where source data exists.
5. Unbuyable products are excluded from writes.
6. Subscription creation sends verification email and stays unconfirmed initially.
7. Verification endpoint confirms valid token and rejects invalid/expired token.
8. Notification run sends emails only for confirmed subscriptions where wine is on sale.
9. Tracking page loads tracked wines and unsubscribe action removes or deactivates tracking.

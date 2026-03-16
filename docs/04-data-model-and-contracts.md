# 04 Data Model and Contracts

## Multi-Shop Target Model

### `canonical_wines`

- `id` (uuid, primary key)
- `canonical_key` (text, unique, normalized matching key)
- `name` (text, required)
- `image_url` (text, nullable)
- `wine_type` (text, nullable)
- `country` (text, nullable)
- `region` (text, nullable)
- `vintage_year` (int, nullable)
- `category_path` (text, nullable)
- `bottle_volume_cl` (decimal, nullable)
- `case_size` (int, nullable)
- `created_at` (timestamptz, required)
- `updated_at` (timestamptz, required)

### `wine_offers`

- `id` (uuid, primary key)
- `canonical_wine_id` (uuid, FK -> canonical_wines.id, required)
- `shop` (text, required; e.g. `denner`, `ottos`)
- `shop_product_id` (text, required; source-stable id)
- `source_url` (text, required)
- `name` (text, required; source-facing name)
- `image_url` (text, nullable)
- `current_price` (decimal, required)
- `base_price` (decimal, nullable)
- `case_price` (decimal, nullable)
- `case_base_price` (decimal, nullable)
- `is_on_sale` (boolean, required)
- `last_scraped_at` (timestamptz, required)
- `created_at` (timestamptz, required)
- `updated_at` (timestamptz, required)
- uniqueness contract:
  - unique `(shop, shop_product_id)`

## Existing Legacy Tables

### `wines`

- `id` (uuid, primary key)
- `name` (text, required)
- `slug` (text, unique, required)
- `denner_product_id` (text, unique, required for API identity)
- `source_url` (text, required)
- `image_url` (text, nullable)
- `current_price` (decimal, required, per-bottle current price)
- `base_price` (decimal, nullable, per-bottle previous price)
- `case_price` (decimal, nullable, current case/pack price)
- `case_base_price` (decimal, nullable, previous case/pack price)
- `wine_type` (text, nullable)
- `country` (text, nullable)
- `region` (text, nullable)
- `vintage_year` (int, nullable)
- `category_path` (text, nullable)
- `bottle_volume_cl` (decimal, nullable)
- `case_size` (int, nullable)
- `is_on_sale` (boolean, required)
- `last_scraped_at` (timestamptz, required)

### `subscriptions`

- `id` (uuid, primary key)
- `email` (text, required)
- `wine_id` (uuid, FK -> wines.id, legacy compatibility)
- `offer_id` (uuid, FK -> wine_offers.id, new target link)
- `is_confirmed` (boolean, required)
- `confirmation_token` (uuid, required)
- `created_at` (timestamptz, required)

## Derived Field Rules

- `is_on_sale = true` when:
  - per-bottle `base_price` exists and
  - per-bottle `current_price < base_price`
- Else `is_on_sale = false`.

## Upsert Contract (`wine_offers`)

- Conflict target: `(shop, shop_product_id)`
- On conflict update fields:
  - `name`
  - `canonical_wine_id`
  - `source_url`
  - `image_url`
  - `current_price`
  - `base_price`
  - `case_price`
  - `case_base_price`
  - `is_on_sale`
  - `last_scraped_at`

## Normalization Contract

- Price parsing:
  - strip currency markers (`CHF`, `Fr.`)
  - normalize comma/dot separator
  - persist numeric value to 2 decimals
- Price semantics:
  - `current_price/base_price` are always per-bottle values.
  - `case_price/case_base_price` are always case/pack values.
- Name parsing:
  - trim whitespace
  - collapse repeated spaces
- Canonical matching key:
  - built from normalized name + vintage + bottle volume + country
  - deterministic and stable across shops where metadata allows
- Matching strategy:
  - strict key match first
  - fuzzy fallback for same-year/same-volume candidates
  - conservative threshold to avoid false merges

## Subscription Contract

- One email can track multiple offers.
- Same canonical wine can be tracked across multiple shops.
- A subscription is active for notifications only if `is_confirmed=true`.
- Verification endpoint must be idempotent:
  - verifying already-confirmed token returns success-like response.

## Planned Next-Phase Token Contract

- Introduce a stable `tracking_token` per email identity for `/my-trackings/[token]`.
- Token must be opaque, unguessable, and server-generated.

# 04 Data Model and Contracts

## Existing Tables

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
- `wine_id` (uuid, FK -> wines.id, required)
- `is_confirmed` (boolean, required)
- `confirmation_token` (uuid, required)
- `created_at` (timestamptz, required)

## Derived Field Rules

- `is_on_sale = true` when:
  - per-bottle `base_price` exists and
  - per-bottle `current_price < base_price`
- Else `is_on_sale = false`.

## Upsert Contract (`wines`)

- Conflict target: `slug`
- On conflict update fields:
  - `name`
  - `denner_product_id`
  - `source_url`
  - `image_url`
  - `current_price`
  - `base_price`
  - `case_price`
  - `case_base_price`
  - `wine_type`
  - `country`
  - `region`
  - `vintage_year`
  - `category_path`
  - `bottle_volume_cl`
  - `case_size`
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
- Slug:
  - prefer URL-derived slug from product link
  - fallback to slugified normalized name
- Metadata parsing:
  - `country`, `region`, `wine_type`, `vintage_year` from product API fields first.
  - DOM fallback is allowed only for missing API responses.

## Subscription Contract

- One email can track multiple wines.
- A subscription is active for notifications only if `is_confirmed=true`.
- Verification endpoint must be idempotent:
  - verifying already-confirmed token returns success-like response.

## Planned Next-Phase Token Contract

- Introduce a stable `tracking_token` per email identity for `/my-trackings/[token]`.
- Token must be opaque, unguessable, and server-generated.

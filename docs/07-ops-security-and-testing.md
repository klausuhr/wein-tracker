# 07 Ops, Security, and Testing

## Security Baseline

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Never log full tokens, keys, or raw secret values.
- Validate all route inputs with schema validation.
- Prefer restrictive Supabase RLS for client-facing operations.
- Any privileged write path must run server-side only.

## Operational Model

- Current mode: manual scraper execution via CLI.
- Next mode: cron-triggered execution (Vercel cron + API/script wrapper).
- Required run metadata:
  - start time
  - duration
  - success/failure status
  - processed/failed counts

## Monitoring Expectations

- Console logs must be structured and searchable.
- Error logs should include:
  - operation name
  - error class
  - recoverable vs fatal indicator

## Test Strategy

### Unit Tests

- Price parser for CHF formats and decimal normalization.
- Price semantic mapper (bottle vs case).
- Slug generation fallback logic.
- Vintage and metadata parser from API fields.
- `is_on_sale` computation.

### Integration Tests

- Env validation behavior with missing keys.
- Supabase upsert behavior on duplicate slug.
- Supabase upsert behavior on extended fields (`country`, `region`, `vintage_year`, case prices).
- Verify endpoint idempotency and token validation.

### Smoke/E2E Tests

- Run scraper with sitemap + product API and verify full-catalog writes.
- Verify only buyable products are persisted.
- Verify bottle and case prices are both mapped correctly.
- Run subscription -> verify flow with mocked email provider.
- Run notification workflow against seeded sale data.

## Minimal Acceptance Test Matrix

1. Scraper first run inserts wines.
2. Scraper second run updates same slugs without duplicates.
3. Imported dataset is significantly larger than teaser-only sample and non-zero.
4. `current_price` is bottle-level price and `case_price` stores case-level price.
5. `country`, `region`, `wine_type`, and `vintage_year` are populated when source data exists.
6. Unconfirmed subscriptions do not receive notifications.
7. Confirmed subscriptions receive notification when wine is on sale.
8. Invalid verification token returns controlled error response.

## Runbooks

### Selector Drift

- Symptom: fallback extraction count spikes or API success rate drops.
- Action:
  - inspect Denner API payload shape first
  - inspect DOM selectors only for fallback adapter
  - run smoke scrape and verify bottle/case pricing

### Supabase Auth Failure

- Symptom: scraper fails on DB write.
- Action:
  - verify service role env vars
  - check key rotation and environment scope

### Resend Delivery Failure

- Symptom: send errors or low delivery.
- Action:
  - verify domain setup and API key
  - inspect provider response codes

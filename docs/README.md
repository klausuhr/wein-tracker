# Wein-Ticker Specification Docs

This folder contains the implementation specs for the Wein-Ticker project.

## Audience

- Full-stack engineers implementing and reviewing the project
- Operators running scraper and notification workflows

## Reading Order

1. `01-tech-stack.md`
2. `02-product-requirements.md`
3. `03-system-design.md`
4. `04-data-model-and-contracts.md`
5. `05-integration-spec.md`
6. `06-scraper-spec.md`
7. `07-ops-security-and-testing.md`

## Canonical Terms

- `wine`: A row in `wines` representing a product from Denner wine shop.
- `subscription`: A row in `subscriptions` representing one email tracking one wine.
- `confirmed`: `subscriptions.is_confirmed = true` after email verification.
- `on_sale`: `wines.is_on_sale = true` when `current_price < base_price`.
- `current_price`: bottle-level current price.
- `case_price`: case/pack-level current price.
- `verification_token`: Token used by `/api/verify?token=...`.
- `tracking_token`: Token used by `/my-trackings/[token]` (planned for next phase).

## Source of Truth Rules

- Functional behavior is defined in `02-product-requirements.md`.
- Architecture and boundaries are defined in `03-system-design.md`.
- Data contracts are defined in `04-data-model-and-contracts.md`.
- External service integration rules are defined in `05-integration-spec.md`.
- Scraper behavior is defined in `06-scraper-spec.md`.
- Security, operations, and testing baselines are defined in `07-ops-security-and-testing.md`.

# 01 Tech Stack

## Runtime and Toolchain

- Node.js: `20.x`
- Package manager: `npm`
- Language: TypeScript
- Framework: Next.js `14` (App Router)
- Styling: Tailwind CSS
- Icons: Lucide
- Scraping runtime: API-first ingestion + Playwright fallback

## Backend and Data

- API layer: Next.js Route Handlers (`app/api/*`)
- Database: Supabase PostgreSQL
- Email provider: Resend
- Deployment target: Vercel + Supabase

## Core Dependencies (Recommended)

- `next`, `react`, `react-dom`
- `@supabase/supabase-js`
- `playwright`
- `resend`
- `zod` for input/environment validation

## Scraping Strategy (v2)

- Primary source: Denner structured endpoints
  - `https://www.denner.ch/sitemap.product.xml`
  - `https://www.denner.ch/api/product/{id}?locale=de`
- Fallback source: Playwright detail-page extraction for product-level API misses.
- Contract:
  - API-first is the default execution path.
  - Playwright is used only per failed product, not for the whole catalog.

## Environment Profiles

- Local development: `.env.local`
- Preview/Production: Vercel environment variables
- Secrets must never be committed to git

## Constraints and Non-Goals (v1)

- No login system and no user password management
- No admin dashboard in v1
- No background queue system in v1 (cron-ready design only)

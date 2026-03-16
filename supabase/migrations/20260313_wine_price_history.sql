create extension if not exists pgcrypto;

create table if not exists public.wine_price_history (
  id uuid primary key default gen_random_uuid(),
  wine_id uuid not null references public.wines(id) on delete cascade,
  denner_product_id text not null,
  scraped_at timestamptz not null default now(),
  current_price numeric(10,2) not null,
  base_price numeric(10,2),
  case_price numeric(10,2),
  case_base_price numeric(10,2),
  is_on_sale boolean not null,
  source_job text not null default 'scrape_wines',
  created_at timestamptz not null default now()
);

create index if not exists idx_wine_price_history_wine_id_scraped_at
  on public.wine_price_history (wine_id, scraped_at desc);

create index if not exists idx_wine_price_history_denner_product_id_scraped_at
  on public.wine_price_history (denner_product_id, scraped_at desc);

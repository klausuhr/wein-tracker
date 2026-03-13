alter table if exists public.wines
  add column if not exists denner_product_id text,
  add column if not exists source_url text,
  add column if not exists case_price numeric(10,2),
  add column if not exists case_base_price numeric(10,2),
  add column if not exists wine_type text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists vintage_year integer,
  add column if not exists category_path text,
  add column if not exists bottle_volume_cl numeric(10,2),
  add column if not exists case_size integer;

create unique index if not exists idx_wines_denner_product_id
  on public.wines (denner_product_id)
  where denner_product_id is not null;

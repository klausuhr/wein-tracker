create extension if not exists pgcrypto;

create table if not exists public.canonical_wines (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  name text not null,
  image_url text,
  wine_type text,
  country text,
  region text,
  vintage_year integer,
  category_path text,
  bottle_volume_cl numeric(10,2),
  case_size integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wine_offers (
  id uuid primary key default gen_random_uuid(),
  canonical_wine_id uuid not null references public.canonical_wines(id) on delete cascade,
  shop text not null,
  shop_product_id text not null,
  source_url text not null,
  name text not null,
  image_url text,
  current_price numeric(10,2) not null,
  base_price numeric(10,2),
  case_price numeric(10,2),
  case_base_price numeric(10,2),
  is_on_sale boolean not null,
  last_scraped_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_wine_offers_shop_product_unique
  on public.wine_offers (shop, shop_product_id);

create index if not exists idx_wine_offers_canonical_wine_id
  on public.wine_offers (canonical_wine_id);

alter table if exists public.subscriptions
  add column if not exists offer_id uuid references public.wine_offers(id) on delete cascade;

alter table if exists public.subscriptions
  alter column wine_id drop not null;

alter table if exists public.notification_events
  add column if not exists offer_id uuid references public.wine_offers(id) on delete cascade;

alter table if exists public.notification_events
  alter column wine_id drop not null;

alter table if exists public.wine_price_history
  add column if not exists offer_id uuid references public.wine_offers(id) on delete cascade,
  add column if not exists shop text,
  add column if not exists shop_product_id text;

alter table if exists public.wine_price_history
  alter column wine_id drop not null,
  alter column denner_product_id drop not null;

create index if not exists idx_wine_price_history_offer_id_scraped_at
  on public.wine_price_history (offer_id, scraped_at desc);

create index if not exists idx_wine_price_history_shop_product_scraped_at
  on public.wine_price_history (shop, shop_product_id, scraped_at desc);

with source_wines as (
  select
    w.*,
    (
      lower(regexp_replace(coalesce(w.name, ''), '[^a-z0-9]+', '', 'g')) || '|' ||
      coalesce(w.vintage_year::text, '') || '|' ||
      coalesce(round(w.bottle_volume_cl)::text, '') || '|' ||
      lower(coalesce(w.country, ''))
    ) as canonical_key
  from public.wines w
)
insert into public.canonical_wines (
  canonical_key,
  name,
  image_url,
  wine_type,
  country,
  region,
  vintage_year,
  category_path,
  bottle_volume_cl,
  case_size
)
select distinct
  s.canonical_key,
  s.name,
  s.image_url,
  s.wine_type,
  s.country,
  s.region,
  s.vintage_year,
  s.category_path,
  s.bottle_volume_cl,
  s.case_size
from source_wines s
where s.name is not null and s.name <> ''
on conflict (canonical_key) do update
set
  name = excluded.name,
  image_url = coalesce(excluded.image_url, public.canonical_wines.image_url),
  wine_type = coalesce(excluded.wine_type, public.canonical_wines.wine_type),
  country = coalesce(excluded.country, public.canonical_wines.country),
  region = coalesce(excluded.region, public.canonical_wines.region),
  vintage_year = coalesce(excluded.vintage_year, public.canonical_wines.vintage_year),
  category_path = coalesce(excluded.category_path, public.canonical_wines.category_path),
  bottle_volume_cl = coalesce(excluded.bottle_volume_cl, public.canonical_wines.bottle_volume_cl),
  case_size = coalesce(excluded.case_size, public.canonical_wines.case_size),
  updated_at = now();

with source_wines as (
  select
    w.*,
    (
      lower(regexp_replace(coalesce(w.name, ''), '[^a-z0-9]+', '', 'g')) || '|' ||
      coalesce(w.vintage_year::text, '') || '|' ||
      coalesce(round(w.bottle_volume_cl)::text, '') || '|' ||
      lower(coalesce(w.country, ''))
    ) as canonical_key,
    coalesce(w.denner_product_id, w.slug) as shop_product_id
  from public.wines w
),
joined as (
  select
    s.*,
    c.id as canonical_wine_id
  from source_wines s
  join public.canonical_wines c on c.canonical_key = s.canonical_key
)
insert into public.wine_offers (
  canonical_wine_id,
  shop,
  shop_product_id,
  source_url,
  name,
  image_url,
  current_price,
  base_price,
  case_price,
  case_base_price,
  is_on_sale,
  last_scraped_at
)
select
  j.canonical_wine_id,
  'denner',
  j.shop_product_id,
  coalesce(
    j.source_url,
    'https://www.denner.ch/de/weinshop/' || coalesce(j.slug, j.shop_product_id) || '.html'
  ),
  j.name,
  j.image_url,
  j.current_price,
  j.base_price,
  j.case_price,
  j.case_base_price,
  j.is_on_sale,
  j.last_scraped_at
from joined j
where j.shop_product_id is not null
on conflict (shop, shop_product_id) do update
set
  canonical_wine_id = excluded.canonical_wine_id,
  source_url = excluded.source_url,
  name = excluded.name,
  image_url = excluded.image_url,
  current_price = excluded.current_price,
  base_price = excluded.base_price,
  case_price = excluded.case_price,
  case_base_price = excluded.case_base_price,
  is_on_sale = excluded.is_on_sale,
  last_scraped_at = excluded.last_scraped_at,
  updated_at = now();

update public.subscriptions s
set offer_id = o.id
from public.wines w
join public.wine_offers o
  on o.shop = 'denner'
 and o.shop_product_id = coalesce(w.denner_product_id, w.slug)
where s.offer_id is null
  and s.wine_id = w.id;

update public.notification_events ne
set offer_id = s.offer_id
from public.subscriptions s
where ne.subscription_id = s.id
  and ne.offer_id is null;

update public.wine_price_history h
set
  shop = coalesce(h.shop, 'denner'),
  shop_product_id = coalesce(h.shop_product_id, h.denner_product_id)
where h.shop is null
   or h.shop_product_id is null;

update public.wine_price_history h
set offer_id = o.id
from public.wine_offers o
where h.offer_id is null
  and o.shop = 'denner'
  and o.shop_product_id = h.shop_product_id;

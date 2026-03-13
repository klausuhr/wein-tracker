create extension if not exists pgcrypto;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  wine_id uuid not null references public.wines(id) on delete cascade,
  last_notified_price numeric(10,2) not null,
  last_notified_base_price numeric(10,2),
  last_notified_at timestamptz not null default now(),
  send_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_notification_events_subscription_unique
  on public.notification_events(subscription_id);

create index if not exists idx_notification_events_wine_id
  on public.notification_events(wine_id);

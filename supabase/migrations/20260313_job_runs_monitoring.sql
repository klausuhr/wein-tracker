create extension if not exists pgcrypto;

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('ok', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_runs_job_name_created_at
  on public.job_runs (job_name, created_at desc);

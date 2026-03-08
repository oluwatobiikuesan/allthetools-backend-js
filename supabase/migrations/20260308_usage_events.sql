create extension if not exists "pgcrypto";

alter table public.jobs
  add column if not exists client_id text,
  add column if not exists source_ip text,
  add column if not exists user_agent text;

create table if not exists public.usage_events (
    id uuid primary key default gen_random_uuid(),
    client_id text,
    workspace_id text,
    tool text not null,
    event_name text not null,
    plan text default 'free',
    metadata jsonb not null default '{}'::jsonb,
    source_ip text,
    user_agent text,
    occurred_at timestamptz default now()
);

create index if not exists usage_events_tool_idx on public.usage_events (tool);
create index if not exists usage_events_event_idx on public.usage_events (event_name);
create index if not exists usage_events_client_idx on public.usage_events (client_id);
create index if not exists usage_events_time_idx on public.usage_events (occurred_at desc);

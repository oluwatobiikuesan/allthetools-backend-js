-- Enable required extensions
create extension if not exists "pgcrypto";

-- Jobs table captures lifecycle + metrics
create table if not exists public.jobs (
    job_id text primary key,
    tool text not null,
    platform text,
    status text not null,
    format text,
    quality text,
    plan text,
    user_id uuid,
    workspace_id uuid,
    submitted_at timestamptz default now(),
    started_at timestamptz,
    completed_at timestamptz,
    queue_wait_ms integer,
    processing_ms integer,
    filesize_bytes bigint,
    video_duration_seconds integer,
    result_filename text,
    error_message text,
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_submitted_at_idx on public.jobs (submitted_at);

-- Cost ledger links infra spend back to jobs
create table if not exists public.cost_ledger (
    id uuid primary key default gen_random_uuid(),
    job_id text not null references public.jobs(job_id) on delete cascade,
    tool text not null,
    egress_gb numeric,
    compute_minutes numeric,
    storage_gb_hours numeric,
    estimated_cost numeric,
    currency text default 'USD',
    recorded_at timestamptz default now()
);

create index if not exists cost_ledger_job_idx on public.cost_ledger (job_id);
create index if not exists cost_ledger_recorded_at_idx on public.cost_ledger (recorded_at);

-- Queue snapshots for ops dashboards
create table if not exists public.queue_metrics (
    id bigserial primary key,
    queue_name text not null,
    waiting integer,
    active integer,
    completed integer,
    failed integer,
    delayed integer,
    total integer,
    captured_at timestamptz default now()
);

create index if not exists queue_metrics_queue_time_idx on public.queue_metrics (queue_name, captured_at desc);

-- Operational data for the Pluggy/Open Finance lifecycle. All tables remain
-- private to the API service role; RLS protects direct authenticated access.
alter table public.open_finance_connections
  add column if not exists institution_name text,
  add column if not exists institution_logo_url text,
  add column if not exists connector_name text,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists disconnected_at timestamptz;

alter table public.cards
  add column if not exists external_account_id text,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'pluggy')),
  add column if not exists last_synced_at timestamptz;

create unique index if not exists cards_external_account_unique
  on public.cards (external_account_id)
  where external_account_id is not null;

create table if not exists public.open_finance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.open_finance_connections(id) on delete set null,
  external_item_id text not null,
  trigger text not null check (trigger in ('connect', 'manual', 'webhook')),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  accounts_synced integer not null default 0,
  transactions_synced integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists open_finance_sync_runs_profile_started_idx
  on public.open_finance_sync_runs (profile_id, started_at desc);

create table if not exists public.open_finance_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('pluggy')),
  external_event_id text,
  external_item_id text,
  event_type text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'FAILED')),
  error_message text
);

create unique index if not exists open_finance_webhook_events_external_event_unique
  on public.open_finance_webhook_events (provider, external_event_id)
  where external_event_id is not null;

alter table public.open_finance_sync_runs enable row level security;
alter table public.open_finance_webhook_events enable row level security;

revoke all on table public.open_finance_sync_runs, public.open_finance_webhook_events from anon;
revoke all on table public.open_finance_sync_runs, public.open_finance_webhook_events from authenticated;
grant select on table public.open_finance_sync_runs to authenticated;

drop policy if exists "open_finance_sync_runs_owner_read" on public.open_finance_sync_runs;
create policy "open_finance_sync_runs_owner_read" on public.open_finance_sync_runs
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = open_finance_sync_runs.profile_id
      and p.user_id = (select auth.uid())
  ));

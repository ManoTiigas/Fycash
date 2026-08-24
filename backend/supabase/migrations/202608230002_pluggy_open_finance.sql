create table if not exists public.open_finance_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'pluggy' check (provider in ('pluggy')),
  external_item_id text not null unique,
  status text not null default 'PENDING',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts add column if not exists connection_id uuid references public.open_finance_connections(id) on delete set null;
alter table public.accounts add column if not exists external_account_id text unique;
alter table public.accounts add column if not exists currency_code char(3) not null default 'BRL';
alter table public.accounts add column if not exists last_synced_at timestamptz;
alter table public.accounts drop constraint if exists accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in ('checking', 'savings', 'cash', 'investment', 'credit'));

alter table public.transactions add column if not exists external_transaction_id text unique;
alter table public.transactions add column if not exists source text not null default 'manual' check (source in ('manual', 'pluggy'));

create index if not exists open_finance_connections_profile_idx on public.open_finance_connections (profile_id);
create index if not exists accounts_connection_idx on public.accounts (connection_id);
create index if not exists transactions_external_transaction_idx on public.transactions (external_transaction_id);

alter table public.open_finance_connections enable row level security;
drop policy if exists "open_finance_connections_owner" on public.open_finance_connections;
create policy "open_finance_connections_owner" on public.open_finance_connections for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

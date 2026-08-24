create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings', 'cash', 'investment')),
  balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  color text not null default '#08b577',
  created_at timestamptz not null default now(),
  unique (profile_id, name, kind)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  brand text,
  last_four char(4),
  credit_limit numeric(14, 2) not null default 0,
  available_limit numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  member text not null,
  date date not null,
  description text not null,
  status text not null check (status in ('Recebido', 'Enviado')),
  category text not null,
  account text not null,
  invoice text not null check (invoice in ('Receita', 'Paga')),
  amount numeric(14, 2) not null check (amount >= 0),
  kind text not null check (kind in ('income', 'expense')),
  created_at timestamptz not null default now()
);

create index if not exists transactions_profile_date_idx on public.transactions (profile_id, date desc);
create index if not exists transactions_kind_idx on public.transactions (kind);
create index if not exists categories_profile_idx on public.categories (profile_id);

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.cards enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "accounts_owner" on public.accounts;
create policy "accounts_owner" on public.accounts for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
drop policy if exists "categories_owner" on public.categories;
create policy "categories_owner" on public.categories for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
drop policy if exists "cards_owner" on public.cards;
create policy "cards_owner" on public.cards for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
drop policy if exists "transactions_owner" on public.transactions;
create policy "transactions_owner" on public.transactions for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

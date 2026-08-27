create table public.recurring_incomes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  account_id uuid references public.accounts(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_incomes_profile_active_idx on public.recurring_incomes(profile_id, active);

create table public.recurring_income_occurrences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recurring_income_id uuid not null references public.recurring_incomes(id) on delete cascade,
  month char(7) not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(recurring_income_id, month)
);

create index recurring_income_occurrences_profile_month_idx on public.recurring_income_occurrences(profile_id, month);

create table public.monthly_goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month char(7) not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  name text not null check (char_length(name) between 1 and 100),
  type text not null check (type in ('income', 'savings')),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monthly_goals_profile_month_idx on public.monthly_goals(profile_id, month);

alter table public.recurring_incomes enable row level security;
alter table public.recurring_income_occurrences enable row level security;
alter table public.monthly_goals enable row level security;

revoke all on table public.recurring_incomes from anon, authenticated;
revoke all on table public.recurring_income_occurrences from anon, authenticated;
revoke all on table public.monthly_goals from anon, authenticated;

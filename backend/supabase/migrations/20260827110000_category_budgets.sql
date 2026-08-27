create table public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 80),
  monthly_limit numeric(14, 2) not null check (monthly_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, category)
);

create index category_budgets_profile_idx on public.category_budgets(profile_id);

alter table public.category_budgets enable row level security;
revoke all on table public.category_budgets from anon, authenticated;

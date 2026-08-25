alter table public.accounts add column if not exists initial_balance numeric(14, 2);
update public.accounts set initial_balance = balance where initial_balance is null;
alter table public.accounts alter column initial_balance set default 0;
alter table public.accounts alter column initial_balance set not null;

create table public.manual_month_closings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  closing_balance numeric(14, 2) not null,
  income numeric(14, 2) not null default 0,
  expenses numeric(14, 2) not null default 0,
  closed_at timestamptz not null default now(),
  unique(profile_id, month)
);
alter table public.manual_month_closings enable row level security;
create policy "manual_month_closings_deny_direct_access" on public.manual_month_closings for all to authenticated using (false) with check (false);

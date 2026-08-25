alter table public.profiles
  add column if not exists manual_cycle_month text,
  add column if not exists manual_cycle_opening_balance numeric(14, 2);

alter table public.manual_month_closings
  add column if not exists opening_balance numeric(14, 2) not null default 0;

create index if not exists manual_month_closings_profile_month_idx
  on public.manual_month_closings (profile_id, month desc);

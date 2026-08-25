alter table public.profiles add column if not exists open_finance_paused boolean not null default false;

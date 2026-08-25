create table public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('open_finance')),
  version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (profile_id, purpose, version)
);

create index privacy_consents_profile_id_idx on public.privacy_consents(profile_id);

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('deletion')),
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index data_subject_requests_profile_id_idx on public.data_subject_requests(profile_id, requested_at desc);

alter table public.privacy_consents enable row level security;
alter table public.data_subject_requests enable row level security;

create policy "privacy_consents_deny_direct_access" on public.privacy_consents for all to authenticated using (false) with check (false);
create policy "data_subject_requests_deny_direct_access" on public.data_subject_requests for all to authenticated using (false) with check (false);

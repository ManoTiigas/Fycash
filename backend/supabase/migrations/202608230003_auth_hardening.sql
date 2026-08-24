alter table public.profiles add column if not exists user_id uuid references auth.users(id) on delete cascade;
create unique index if not exists profiles_user_id_unique on public.profiles (user_id) where user_id is not null;

revoke all on table public.profiles, public.accounts, public.categories, public.cards, public.transactions, public.open_finance_connections from anon;
revoke all on table public.profiles, public.accounts, public.categories, public.cards, public.transactions, public.open_finance_connections from authenticated;
grant select, insert, update, delete on table public.profiles, public.accounts, public.categories, public.cards, public.transactions, public.open_finance_connections to authenticated;

drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "accounts_owner" on public.accounts;
create policy "accounts_owner" on public.accounts for all to authenticated using (exists (select 1 from public.profiles p where p.id = accounts.profile_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.profiles p where p.id = accounts.profile_id and p.user_id = (select auth.uid())));
drop policy if exists "categories_owner" on public.categories;
create policy "categories_owner" on public.categories for all to authenticated using (exists (select 1 from public.profiles p where p.id = categories.profile_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.profiles p where p.id = categories.profile_id and p.user_id = (select auth.uid())));
drop policy if exists "cards_owner" on public.cards;
create policy "cards_owner" on public.cards for all to authenticated using (exists (select 1 from public.profiles p where p.id = cards.profile_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.profiles p where p.id = cards.profile_id and p.user_id = (select auth.uid())));
drop policy if exists "transactions_owner" on public.transactions;
create policy "transactions_owner" on public.transactions for all to authenticated using (exists (select 1 from public.profiles p where p.id = transactions.profile_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.profiles p where p.id = transactions.profile_id and p.user_id = (select auth.uid())));
drop policy if exists "open_finance_connections_owner" on public.open_finance_connections;
create policy "open_finance_connections_owner" on public.open_finance_connections for all to authenticated using (exists (select 1 from public.profiles p where p.id = open_finance_connections.profile_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.profiles p where p.id = open_finance_connections.profile_id and p.user_id = (select auth.uid())));

-- This is an API/service-role audit table. Authenticated browser clients have
-- no permissible operation, while the service role still bypasses RLS.
drop policy if exists "open_finance_webhook_events_no_direct_access" on public.open_finance_webhook_events;
create policy "open_finance_webhook_events_no_direct_access" on public.open_finance_webhook_events
  for all to authenticated
  using (false)
  with check (false);

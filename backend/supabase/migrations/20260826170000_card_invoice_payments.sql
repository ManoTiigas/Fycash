-- A debit-account transaction can represent payment of a connected credit-card invoice.
-- card_id preserves the paid card while account_id preserves the account that paid it.
alter table public.transactions
  drop constraint if exists transactions_invoice_check;

alter table public.transactions
  add constraint transactions_invoice_check
  check (invoice in ('Receita', 'Paga', 'Fatura paga'));

create index if not exists transactions_profile_card_date_idx
  on public.transactions (profile_id, card_id, date desc)
  where card_id is not null;

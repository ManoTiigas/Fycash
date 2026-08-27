insert into public.categories (profile_id, name, kind)
select distinct profile_id, trim(category), 'expense'
from public.transactions
where kind = 'expense' and trim(category) <> ''
on conflict (profile_id, name, kind) do nothing;

import 'dotenv/config';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from './auth.js';
import { createConnectToken, syncPluggyItem } from './pluggy.js';
import { supabase } from './supabase.js';

type TransactionKind = 'income' | 'expense';
interface Transaction {
  id: string;
  member: string;
  date: string;
  description: string;
  status: 'Recebido' | 'Enviado';
  category: string;
  account: string;
  invoice: 'Receita' | 'Paga';
  amount: number;
  kind: TransactionKind;
}

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? false, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

const appProfileId = (request: { profileId?: string }) => {
  const profileId = request.profileId;
  if (!profileId) throw new Error('Perfil autenticado obrigatório.');
  return profileId;
};

app.use('/api', (request, response, next) => request.path === '/open-finance/pluggy/webhook' ? next() : requireAuth(request, response, next));

app.post('/api/open-finance/pluggy/connect-token', async (request, response) => {
  try {
    const profileId = appProfileId(request);
    const { data: profile, error } = await supabase.from('profiles').select('id').eq('id', profileId).maybeSingle();
    if (error) throw error;
    if (!profile) return response.status(400).json({ error: 'O perfil configurado não existe no Supabase.' });
    response.json({ connectToken: await createConnectToken(profileId) });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Não foi possível iniciar a conexão bancária.' });
  }
});

app.post('/api/open-finance/pluggy/items/:itemId/sync', async (request, response) => {
  try {
    const result = await syncPluggyItem(request.params.itemId, appProfileId(request), 'connect');
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Não foi possível sincronizar os dados bancários.' });
  }
});

app.get('/api/open-finance/connections', async (request, response) => {
  const profileId = appProfileId(request);
  const { data, error } = await supabase.from('open_finance_connections')
    .select('id, external_item_id, provider, status, institution_name, institution_logo_url, connector_name, last_synced_at, last_successful_sync_at, last_error, disconnected_at, created_at')
    .eq('profile_id', profileId).order('created_at', { ascending: false });
  if (error) return response.status(500).json({ error: error.message });
  response.json(data);
});

app.post('/api/open-finance/connections/:connectionId/sync', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: connection, error } = await supabase.from('open_finance_connections').select('external_item_id').eq('id', request.params.connectionId).eq('profile_id', profileId).maybeSingle();
  if (error) return response.status(500).json({ error: error.message });
  if (!connection) return response.status(404).json({ error: 'Conexão não encontrada.' });
  try {
    response.json(await syncPluggyItem(connection.external_item_id, profileId, 'manual'));
  } catch (syncError) {
    response.status(500).json({ error: syncError instanceof Error ? syncError.message : 'Não foi possível sincronizar a conexão.' });
  }
});

app.delete('/api/open-finance/connections/:connectionId', async (request, response) => {
  const { error } = await supabase.from('open_finance_connections').update({ status: 'DISCONNECTED', disconnected_at: new Date().toISOString() }).eq('id', request.params.connectionId).eq('profile_id', appProfileId(request));
  if (error) return response.status(500).json({ error: error.message });
  response.sendStatus(204);
});

app.post('/api/open-finance/pluggy/webhook', async (request, response) => {
  const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!webhookSecret || request.query.token !== webhookSecret) return response.sendStatus(401);

  const payload = request.body as { id?: string; eventId?: string; event?: string; itemId?: string; clientUserId?: string };
  if (!payload.itemId || !payload.clientUserId) return response.sendStatus(202);

  try {
    const eventId = payload.eventId ?? payload.id;
    if (eventId) {
      const event = await supabase.from('open_finance_webhook_events').upsert({ provider: 'pluggy', external_event_id: eventId, external_item_id: payload.itemId, event_type: payload.event ?? null, status: 'RECEIVED' }, { onConflict: 'provider,external_event_id', ignoreDuplicates: true }).select('id').maybeSingle();
      if (!event.data) return response.sendStatus(204);
      await syncPluggyItem(payload.itemId, payload.clientUserId, 'webhook');
      await supabase.from('open_finance_webhook_events').update({ status: 'PROCESSED', processed_at: new Date().toISOString() }).eq('id', event.data.id);
    } else await syncPluggyItem(payload.itemId, payload.clientUserId, 'webhook');
    response.sendStatus(204);
  } catch (error) {
    console.error('Pluggy webhook sync failed', error);
    response.sendStatus(500);
  }
});

app.get('/api/transactions', async (request, response) => {
  const kind = request.query.kind;
  let query = supabase.from('transactions').select('*').order('date', { ascending: false });
  query = query.eq('profile_id', appProfileId(request));
  if (kind === 'income' || kind === 'expense') query = query.eq('kind', kind);
  if (typeof request.query.from === 'string') query = query.gte('date', request.query.from);
  if (typeof request.query.to === 'string') query = query.lte('date', request.query.to);
  if (typeof request.query.q === 'string' && request.query.q.trim()) query = query.or(`description.ilike.%${request.query.q.trim().replace(/[,%()]/g, '')}%,category.ilike.%${request.query.q.trim().replace(/[,%()]/g, '')}%,account.ilike.%${request.query.q.trim().replace(/[,%()]/g, '')}%`);
  const { data, error } = await query;
  if (error) return response.status(500).json({ error: error.message });
  response.json(data);
});

app.post('/api/transactions', async (request: Request<object, Transaction, Partial<Transaction>>, response: Response) => {
  const { member, date, description, status, category, account, invoice, amount, kind } = request.body;
  if (!member || !date || !description || !status || !category || !account || !invoice || typeof amount !== 'number' || !Number.isFinite(amount) || (kind !== 'income' && kind !== 'expense')) {
    response.status(400).json({ error: 'Dados da transação são inválidos.' });
    return;
  }

  const { data, error } = await supabase.from('transactions').insert({ profile_id: appProfileId(request), member, date, description, status, category, account, invoice, amount, kind }).select().single();
  if (error) return response.status(500).json({ error: error.message });
  response.status(201).json(data);
});

app.get('/api/dashboard', async (request, response) => {
  let query = supabase.from('transactions').select('*').order('date', { ascending: false });
  query = query.eq('profile_id', appProfileId(request));
  if (typeof request.query.from === 'string') query = query.gte('date', request.query.from);
  if (typeof request.query.to === 'string') query = query.lte('date', request.query.to);
  const { data: transactions, error } = await query;
  if (error) return response.status(500).json({ error: error.message });
  const income = transactions.filter((transaction) => transaction.kind === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const expenses = transactions.filter((transaction) => transaction.kind === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const profileId = appProfileId(request);
  const [{ data: accounts, error: accountsError }, { data: cards, error: cardsError }, { data: connections, error: connectionsError }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, balance, currency_code, last_synced_at').eq('profile_id', profileId).order('name'),
    supabase.from('cards').select('id, name, brand, last_four, credit_limit, available_limit, last_synced_at').eq('profile_id', profileId).order('name'),
    supabase.from('open_finance_connections').select('id, status, institution_name, last_successful_sync_at, last_error').eq('profile_id', profileId).is('disconnected_at', null).order('created_at', { ascending: false })
  ]);
  if (accountsError || cardsError || connectionsError) return response.status(500).json({ error: accountsError?.message ?? cardsError?.message ?? connectionsError?.message });
  const categoryTotals = new Map<string, number>();
  const monthly = new Map<string, { income: number; expenses: number }>();
  for (const transaction of transactions) {
    if (transaction.kind === 'expense') categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + Number(transaction.amount));
    const key = transaction.date.slice(0, 7);
    const value = monthly.get(key) ?? { income: 0, expenses: 0 };
    value[transaction.kind === 'income' ? 'income' : 'expenses'] += Number(transaction.amount);
    monthly.set(key, value);
  }
  const categories = [...categoryTotals].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amount]) => ({ name, amount, percent: expenses ? Math.round(amount / expenses * 100) : 0 }));
  const chart = [...monthly].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([month, value]) => ({ month, ...value }));
  response.json({ balance: income - expenses, income, expenses, transactions, accounts, cards, connections, categories, chart });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Fycash API running at http://localhost:${port}`);
  });
}

export default app;

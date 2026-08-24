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
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? false, methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type'] }));
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
    const result = await syncPluggyItem(request.params.itemId, appProfileId(request));
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Não foi possível sincronizar os dados bancários.' });
  }
});

app.post('/api/open-finance/pluggy/webhook', async (request, response) => {
  const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!webhookSecret || request.query.token !== webhookSecret) return response.sendStatus(401);

  const payload = request.body as { event?: string; itemId?: string; clientUserId?: string };
  if (!payload.itemId || !payload.clientUserId) return response.sendStatus(202);

  try {
    await syncPluggyItem(payload.itemId, payload.clientUserId);
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
  const { data: transactions, error } = await query;
  if (error) return response.status(500).json({ error: error.message });
  const income = transactions.filter((transaction) => transaction.kind === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const expenses = transactions.filter((transaction) => transaction.kind === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  response.json({ balance: income - expenses, income, expenses, transactions });
});

app.listen(port, () => {
  console.log(`Fycash API running at http://localhost:${port}`);
});

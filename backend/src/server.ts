import 'dotenv/config';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import multer from 'multer';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { requireAuth } from './auth.js';
import { createConnectToken, syncPluggyItem } from './pluggy.js';
import { parseStatementPdf as parseStructuredStatement } from './statement-parser.js';
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
  accountId?: string;
  cardId?: string;
}

const privacyPolicyVersion = '2026-08-25';


const app = express();
const port = Number(process.env.PORT ?? 3000);
const statementUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

app.use(helmet());
app.set('trust proxy', 1);
const configuredOrigins = process.env.FRONTEND_ORIGIN?.split(',').map(origin => origin.trim()).filter(Boolean) ?? [];
app.use(cors({
  origin(origin, callback) {
    const localDevelopmentOrigin = Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
    callback(null, !origin || configuredOrigins.includes(origin) || localDevelopmentOrigin);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: request => ipKeyGenerator(request.ip ?? 'unknown') }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

const appProfileId = (request: { profileId?: string }) => {
  const profileId = request.profileId;
  if (!profileId) throw new Error('Perfil autenticado obrigatório.');
  return profileId;
};

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
};

async function ensureManualMonth(profileId: string) {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('open_finance_paused, open_finance_paused_at, manual_cycle_month, manual_cycle_opening_balance').eq('id', profileId).single();
  if (profileError) throw profileError;
  if (!profile.open_finance_paused) return profile;

  const { data: accounts, error: accountsError } = await supabase.from('accounts').select('balance').eq('profile_id', profileId).is('external_account_id', null);
  if (accountsError) throw accountsError;
  const balance = (accounts ?? []).reduce((sum, account) => sum + Number(account.balance), 0);
  const month = currentMonth();

  if (!profile.manual_cycle_month || profile.manual_cycle_opening_balance === null) {
    const { error } = await supabase.from('profiles').update({ manual_cycle_month: month, manual_cycle_opening_balance: balance }).eq('id', profileId);
    if (error) throw error;
    return { ...profile, manual_cycle_month: month, manual_cycle_opening_balance: balance };
  }
  if (profile.manual_cycle_month !== month) {
    const opening = Number(profile.manual_cycle_opening_balance);
    const { data: previousTransactions, error: transactionsError } = await supabase.from('transactions').select('amount, kind, account_id').eq('profile_id', profileId).eq('source', 'manual').gte('date', `${profile.manual_cycle_month}-01`).lt('date', `${month}-01`);
    if (transactionsError) throw transactionsError;
    const paidFromAccounts = (previousTransactions ?? []).filter(item => item.kind === 'expense' && item.account_id).reduce((sum, item) => sum + Number(item.amount), 0);
    const income = Math.max(0, balance - opening + paidFromAccounts);
    const expenses = (previousTransactions ?? []).filter(item => item.kind === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
    const { error: closeError } = await supabase.from('manual_month_closings').upsert({ profile_id: profileId, month: profile.manual_cycle_month, opening_balance: opening, closing_balance: balance, income, expenses }, { onConflict: 'profile_id,month' });
    if (closeError) throw closeError;
    const { error: updateError } = await supabase.from('profiles').update({ manual_cycle_month: month, manual_cycle_opening_balance: balance }).eq('id', profileId);
    if (updateError) throw updateError;
    return { ...profile, manual_cycle_month: month, manual_cycle_opening_balance: balance };
  }
  return profile;
}

type ImportedTransaction = { date: string; description: string; amount: number; kind: TransactionKind };
const normalizeAmount = (value: string) => Number(value.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
function parseStatementPdf(text: string): ImportedTransaction[] {
  const results: ImportedTransaction[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const date = line.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const amountMatches = [...line.matchAll(/-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}/g)];
    const amountMatch = amountMatches[amountMatches.length - 1];
    if (!date || !amountMatch) continue;
    const amount = normalizeAmount(amountMatch[0]);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const description = line.slice((date.index ?? 0) + date[0].length, amountMatch.index).replace(/^(?:\s|[-|])+/, '').trim();
    if (!description || /^(saldo|total|limite)/i.test(description)) continue;
    const isExpense = amount < 0 || /\b(debito|débito|pagamento|compra|sa[ií]da)\b/i.test(line);
    results.push({ date: `${date[3]}-${date[2]}-${date[1]}`, description: description.slice(0, 200), amount: Math.abs(amount), kind: isExpense ? 'expense' : 'income' });
  }
  return results;
}

app.use('/api', (request, response, next) => request.path === '/open-finance/pluggy/webhook' ? next() : requireAuth(request, response, next));

app.get('/api/profile', async (request, response) => {
  const { data, error } = await supabase.from('profiles').select('display_name, avatar_url, open_finance_paused, open_finance_paused_at').eq('id', appProfileId(request)).single();
  if (error) return response.status(500).json({ error: error.message });
  response.json({ ...data, email: request.userEmail ?? null });
});

app.patch('/api/profile/open-finance-mode', async (request, response) => {
  if (typeof request.body.paused !== 'boolean') return response.status(400).json({ error: 'Informe o estado do Open Finance.' });
  const { data, error } = await supabase.from('profiles').update({ open_finance_paused: request.body.paused, open_finance_paused_at: request.body.paused ? new Date().toISOString() : null }).eq('id', appProfileId(request)).select('open_finance_paused, open_finance_paused_at').single();
  if (error) return response.status(500).json({ error: error.message });
  response.json(data);
});

app.patch('/api/profile', async (request, response) => {
  const displayName = typeof request.body.displayName === 'string' ? request.body.displayName.trim() : '';
  if (!displayName || displayName.length > 80) return response.status(400).json({ error: 'Informe um nome entre 1 e 80 caracteres.' });
  const { data, error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', appProfileId(request)).select('display_name, avatar_url').single();
  if (error) return response.status(500).json({ error: error.message });
  response.json({ ...data, email: request.userEmail ?? null });
});

app.get('/api/privacy/consent', async (request, response) => {
  const { data, error } = await supabase.from('privacy_consents').select('granted_at').eq('profile_id', appProfileId(request)).eq('purpose', 'open_finance').eq('version', privacyPolicyVersion).is('revoked_at', null).maybeSingle();
  if (error) return response.status(500).json({ error: error.message });
  response.json({ openFinanceConsent: Boolean(data), version: privacyPolicyVersion, grantedAt: data?.granted_at ?? null });
});

app.post('/api/privacy/consent', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: existing, error: findError } = await supabase.from('privacy_consents').select('id').eq('profile_id', profileId).eq('purpose', 'open_finance').eq('version', privacyPolicyVersion).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  const query = existing ? supabase.from('privacy_consents').update({ granted_at: new Date().toISOString(), revoked_at: null }).eq('id', existing.id) : supabase.from('privacy_consents').insert({ profile_id: profileId, purpose: 'open_finance', version: privacyPolicyVersion });
  const { error } = await query;
  if (error) return response.status(500).json({ error: error.message });
  response.status(201).json({ openFinanceConsent: true, version: privacyPolicyVersion });
});

app.post('/api/privacy/revoke-open-finance', async (request, response) => {
  const profileId = appProfileId(request); const now = new Date().toISOString();
  const [{ error: consentError }, { error: connectionsError }] = await Promise.all([
    supabase.from('privacy_consents').update({ revoked_at: now }).eq('profile_id', profileId).eq('purpose', 'open_finance').is('revoked_at', null),
    supabase.from('open_finance_connections').update({ status: 'DISCONNECTED', disconnected_at: now }).eq('profile_id', profileId).is('disconnected_at', null)
  ]);
  if (consentError || connectionsError) return response.status(500).json({ error: consentError?.message ?? connectionsError?.message });
  response.sendStatus(204);
});

app.get('/api/privacy/export', async (request, response) => {
  const profileId = appProfileId(request);
  const [profile, accounts, cards, transactions, connections, consents] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_url, created_at').eq('id', profileId).single(), supabase.from('accounts').select('*').eq('profile_id', profileId), supabase.from('cards').select('*').eq('profile_id', profileId), supabase.from('transactions').select('*').eq('profile_id', profileId).order('date', { ascending: false }), supabase.from('open_finance_connections').select('provider, institution_name, status, created_at, last_synced_at, disconnected_at').eq('profile_id', profileId), supabase.from('privacy_consents').select('purpose, version, granted_at, revoked_at').eq('profile_id', profileId)
  ]);
  const failure = [profile, accounts, cards, transactions, connections, consents].find(result => result.error)?.error;
  if (failure) return response.status(500).json({ error: failure.message });
  response.json({ format: 'fycash-data-export-v1', exported_at: new Date().toISOString(), profile: { ...profile.data, email: request.userEmail ?? null }, accounts: accounts.data, cards: cards.data, transactions: transactions.data, open_finance_connections: connections.data, consents: consents.data });
});

app.post('/api/privacy/deletion-request', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: existing, error: findError } = await supabase.from('data_subject_requests').select('id, requested_at').eq('profile_id', profileId).eq('request_type', 'deletion').eq('status', 'PENDING').maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (existing) return response.status(202).json({ request: existing, alreadyRequested: true });
  const { data, error } = await supabase.from('data_subject_requests').insert({ profile_id: profileId, request_type: 'deletion' }).select('id, requested_at').single();
  if (error) return response.status(500).json({ error: error.message });
  response.status(202).json({ request: data, alreadyRequested: false });
});

app.post('/api/open-finance/pluggy/connect-token', async (request, response) => {
  try {
    const profileId = appProfileId(request);
    const { data: profile, error } = await supabase.from('profiles').select('id, open_finance_paused').eq('id', profileId).maybeSingle();
    if (error) throw error;
    if (!profile) return response.status(400).json({ error: 'O perfil configurado não existe no Supabase.' });
    if (profile.open_finance_paused) return response.status(409).json({ error: 'Open Finance está pausado. Ative-o nas configurações para conectar um banco.' });
    const { data: consent, error: consentError } = await supabase.from('privacy_consents').select('id').eq('profile_id', profileId).eq('purpose', 'open_finance').eq('version', privacyPolicyVersion).is('revoked_at', null).maybeSingle();
    if (consentError) throw consentError;
    if (!consent) return response.status(403).json({ error: 'Consentimento LGPD para Open Finance é obrigatório.' });
    response.json({ connectToken: await createConnectToken(profileId) });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Não foi possível iniciar a conexão bancária.' });
  }
});

app.post('/api/open-finance/pluggy/items/:itemId/sync', async (request, response) => {
  try {
    const profileId = appProfileId(request);
    const { data: profile } = await supabase.from('profiles').select('open_finance_paused').eq('id', profileId).maybeSingle();
    if (profile?.open_finance_paused) return response.status(409).json({ error: 'Open Finance está pausado.' });
    const result = await syncPluggyItem(request.params.itemId, profileId, 'connect');
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
  const { data: profile } = await supabase.from('profiles').select('open_finance_paused').eq('id', profileId).maybeSingle();
  if (profile?.open_finance_paused) return response.status(409).json({ error: 'Open Finance está pausado.' });
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

app.post('/api/accounts', async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  const type = request.body.type;
  const balance = Number(request.body.balance);
  if (!name || name.length > 80 || !['checking', 'savings', 'cash', 'investment'].includes(type) || !Number.isFinite(balance)) return response.status(400).json({ error: 'Dados da conta são inválidos.' });
  const { data, error } = await supabase.from('accounts').insert({ profile_id: appProfileId(request), name, type, balance, initial_balance: balance }).select('id, name, type, balance, currency_code, last_synced_at').single();
  if (error) return response.status(500).json({ error: error.message });
  response.status(201).json(data);
});

app.delete('/api/accounts/:accountId', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: account, error: findError } = await supabase.from('accounts').select('id, external_account_id').eq('id', request.params.accountId).eq('profile_id', profileId).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (!account) return response.status(404).json({ error: 'Conta não encontrada.' });
  if (account.external_account_id) return response.status(409).json({ error: 'Contas Open Finance não podem ser apagadas manualmente.' });
  const { error } = await supabase.from('accounts').delete().eq('id', account.id).eq('profile_id', profileId);
  if (error) return response.status(500).json({ error: error.message });
  response.sendStatus(204);
});

app.patch('/api/accounts/:accountId', async (request, response) => {
  const profileId = appProfileId(request);
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  const type = request.body.type;
  const balance = Number(request.body.balance);
  if (!name || name.length > 80 || !['checking', 'savings', 'cash', 'investment'].includes(type) || !Number.isFinite(balance)) return response.status(400).json({ error: 'Dados da conta são inválidos.' });
  const { data: account, error: findError } = await supabase.from('accounts').select('id, external_account_id').eq('id', request.params.accountId).eq('profile_id', profileId).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (!account) return response.status(404).json({ error: 'Conta não encontrada.' });
  if (account.external_account_id) return response.status(409).json({ error: 'Contas Open Finance não podem ser editadas manualmente.' });
  const { data, error } = await supabase.from('accounts').update({ name, type, balance }).eq('id', account.id).eq('profile_id', profileId).select('id, name, type, balance, currency_code, last_synced_at, external_account_id').single();
  if (error) return response.status(500).json({ error: error.message });
  response.json(data);
});

app.post('/api/cards', async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  const limit = Number(request.body.limit);
  if (!name || name.length > 80 || !Number.isFinite(limit) || limit < 0) return response.status(400).json({ error: 'Dados do cartão são inválidos.' });
  const { data, error } = await supabase.from('cards').insert({ profile_id: appProfileId(request), source: 'manual', name, brand: typeof request.body.brand === 'string' ? request.body.brand.slice(0, 30) : null, credit_limit: limit, available_limit: limit }).select('id, name, brand, last_four, credit_limit, available_limit, last_synced_at').single();
  if (error) return response.status(500).json({ error: error.message });
  response.status(201).json(data);
});

app.patch('/api/cards/:cardId', async (request, response) => {
  const profileId = appProfileId(request);
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  const limit = Number(request.body.limit);
  if (!name || name.length > 80 || !Number.isFinite(limit) || limit < 0) return response.status(400).json({ error: 'Dados do cartão são inválidos.' });
  const { data: card, error: findError } = await supabase.from('cards').select('id, source, credit_limit, available_limit').eq('id', request.params.cardId).eq('profile_id', profileId).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (!card) return response.status(404).json({ error: 'Cartão não encontrado.' });
  if (card.source !== 'manual') return response.status(409).json({ error: 'Cartões Open Finance não podem ser editados manualmente.' });
  const usedLimit = Math.max(0, Number(card.credit_limit) - Number(card.available_limit));
  const { data, error } = await supabase.from('cards').update({ name, brand: typeof request.body.brand === 'string' ? request.body.brand.slice(0, 30) : null, credit_limit: limit, available_limit: Math.max(0, limit - usedLimit) }).eq('id', card.id).eq('profile_id', profileId).select('id, name, brand, last_four, credit_limit, available_limit, last_synced_at, source').single();
  if (error) return response.status(500).json({ error: error.message });
  response.json(data);
});

app.delete('/api/cards/:cardId', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: card, error: findError } = await supabase.from('cards').select('id, source').eq('id', request.params.cardId).eq('profile_id', profileId).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (!card) return response.status(404).json({ error: 'Cartão não encontrado.' });
  if (card.source !== 'manual') return response.status(409).json({ error: 'Cartões Open Finance não podem ser apagados manualmente.' });
  const { error } = await supabase.from('cards').delete().eq('id', card.id).eq('profile_id', profileId);
  if (error) return response.status(500).json({ error: error.message });
  response.sendStatus(204);
});

app.post('/api/open-finance/pluggy/webhook', async (request, response) => {
  const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!webhookSecret || request.query.token !== webhookSecret) return response.sendStatus(401);

  const payload = request.body as { id?: string; eventId?: string; event?: string; itemId?: string; clientUserId?: string };
  if (!payload.itemId || !payload.clientUserId) return response.sendStatus(202);

  try {
    const { data: profile } = await supabase.from('profiles').select('open_finance_paused').eq('id', payload.clientUserId).maybeSingle();
    if (profile?.open_finance_paused) return response.sendStatus(204);
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

app.post('/api/imports/statement-pdf/preview', statementUpload.single('statement'), async (request, response) => {
  const file = request.file;
  if (!file || file.mimetype !== 'application/pdf' || !file.buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) return response.status(400).json({ error: 'Envie um arquivo PDF válido de até 8 MB.' });
  try {
    const parsed = await pdf(file.buffer);
    const statement = parseStructuredStatement(parsed.text);
    if (!statement.transactions.length) return response.status(422).json({ error: 'Não encontramos transações legíveis. Use um extrato PDF com datas e valores.' });
    response.json({ provider: statement.provider, transactions: statement.transactions.slice(0, 500) });
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? `Não foi possível ler o PDF: ${error.message}` : 'Não foi possível ler o PDF.' });
  }
});

app.post('/api/imports/statement-pdf', statementUpload.single('statement'), async (request, response) => {
  const file = request.file;
  if (!file || file.mimetype !== 'application/pdf' || !file.buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) return response.status(400).json({ error: 'Envie um arquivo PDF válido de até 8 MB.' });
  try {
    const parsed = await pdf(file.buffer);
    const statement = parseStructuredStatement(parsed.text);
    const transactions = statement.transactions.slice(0, 500);
    if (!transactions.length) return response.status(422).json({ error: 'Não encontramos transações legíveis. Use um extrato PDF com datas e valores.' });
    const profileId = appProfileId(request);
    const dates = transactions.map(item => item.date).sort();
    const { data: existing, error: existingError } = await supabase.from('transactions').select('date, description, amount, kind').eq('profile_id', profileId).gte('date', dates[0]).lte('date', dates[dates.length - 1]!);
    if (existingError) return response.status(500).json({ error: existingError.message });
    const signatures = new Set((existing ?? []).map(item => `${item.date}|${item.description.toLowerCase()}|${Number(item.amount)}|${item.kind}`));
    const unique = transactions.filter(item => !signatures.has(`${item.date}|${item.description.toLowerCase()}|${item.amount}|${item.kind}`));
    if (!unique.length) return response.json({ imported: 0, skipped: transactions.length, message: 'Este extrato já foi importado.' });
    const accountName = statement.provider === 'nubank' ? 'Nubank (PDF)' : statement.provider === 'mercado_pago' ? 'Mercado Pago (PDF)' : 'Extrato PDF';
    const { error } = await supabase.from('transactions').insert(unique.map(item => ({ profile_id: profileId, source: 'manual', member: 'Extrato PDF', date: item.date, description: item.description, status: item.kind === 'income' ? 'Recebido' : 'Enviado', category: item.kind === 'income' ? 'Receitas' : 'Despesas', account: accountName, invoice: item.kind === 'income' ? 'Receita' : 'Paga', amount: item.amount, kind: item.kind })));
    if (error) return response.status(500).json({ error: error.message });
    const incomeImported = unique.filter(item => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0);
    response.status(201).json({ provider: statement.provider, imported: unique.length, skipped: transactions.length - unique.length, incomeImported, transactions: unique, message: 'Extrato importado com sucesso.' });
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? `Não foi possível ler o PDF: ${error.message}` : 'Não foi possível ler o PDF.' });
  }
});

app.post('/api/transactions', async (request: Request<object, Transaction, Partial<Transaction>>, response: Response) => {
  const { member, date, description, status, category, account, accountId, cardId, invoice, amount, kind } = request.body;
  if (!member || !date || !description || !status || !category || !account || !invoice || typeof amount !== 'number' || !Number.isFinite(amount) || (kind !== 'income' && kind !== 'expense')) {
    response.status(400).json({ error: 'Dados da transação são inválidos.' });
    return;
  }

  const profileId = appProfileId(request);
  const { data: mode } = await supabase.from('profiles').select('open_finance_paused').eq('id', profileId).single();
  if (!mode?.open_finance_paused) return response.status(409).json({ error: 'Ative o modo manual para registrar lançamentos manuais.' });
  let ownedAccount: { id: string; balance: number } | null = null;
  if (accountId) {
    const { data, error: accountError } = await supabase.from('accounts').select('id, balance').eq('id', accountId).eq('profile_id', profileId).maybeSingle();
    if (accountError) return response.status(500).json({ error: accountError.message });
    if (!data) return response.status(400).json({ error: 'A conta selecionada não pertence ao usuário.' });
    ownedAccount = data;
  }
  let ownedCard: { id: string; available_limit: number } | null = null;
  if (cardId) { const { data, error } = await supabase.from('cards').select('id, available_limit').eq('id', cardId).eq('profile_id', profileId).eq('source', 'manual').maybeSingle(); if (error) return response.status(500).json({ error: error.message }); if (!data || kind !== 'expense' || data.available_limit < amount) return response.status(400).json({ error: 'Cartão inválido ou limite insuficiente.' }); ownedCard = data; }
  const { data, error } = await supabase.from('transactions').insert({ profile_id: profileId, account_id: accountId ?? null, card_id: cardId ?? null, source: 'manual', member, date, description, status, category, account, invoice, amount, kind }).select().single();
  if (error) return response.status(500).json({ error: error.message });
  if (ownedAccount) { const nextBalance = Number(ownedAccount.balance) + (kind === 'income' ? amount : -amount); await supabase.from('accounts').update({ balance: nextBalance }).eq('id', ownedAccount.id); }
  if (ownedCard) await supabase.from('cards').update({ available_limit: Number(ownedCard.available_limit) - amount }).eq('id', ownedCard.id);
  response.status(201).json(data);
});

app.delete('/api/transactions/:transactionId', async (request, response) => {
  const profileId = appProfileId(request);
  const { data: transaction, error: findError } = await supabase.from('transactions').select('id, kind, amount, account_id, card_id, source').eq('id', request.params.transactionId).eq('profile_id', profileId).maybeSingle();
  if (findError) return response.status(500).json({ error: findError.message });
  if (!transaction) return response.status(404).json({ error: 'Despesa não encontrada.' });
  if (transaction.source !== 'manual' || transaction.kind !== 'expense') return response.status(409).json({ error: 'Somente despesas manuais podem ser apagadas.' });

  if (transaction.account_id) {
    const { data: account, error: accountError } = await supabase.from('accounts').select('id, balance').eq('id', transaction.account_id).eq('profile_id', profileId).maybeSingle();
    if (accountError) return response.status(500).json({ error: accountError.message });
    if (account) {
      const { error } = await supabase.from('accounts').update({ balance: Number(account.balance) + Number(transaction.amount) }).eq('id', account.id).eq('profile_id', profileId);
      if (error) return response.status(500).json({ error: error.message });
    }
  }
  if (transaction.card_id) {
    const { data: card, error: cardError } = await supabase.from('cards').select('id, credit_limit, available_limit').eq('id', transaction.card_id).eq('profile_id', profileId).eq('source', 'manual').maybeSingle();
    if (cardError) return response.status(500).json({ error: cardError.message });
    if (card) {
      const available = Math.min(Number(card.credit_limit), Number(card.available_limit) + Number(transaction.amount));
      const { error } = await supabase.from('cards').update({ available_limit: available }).eq('id', card.id).eq('profile_id', profileId);
      if (error) return response.status(500).json({ error: error.message });
    }
  }
  const { error } = await supabase.from('transactions').delete().eq('id', transaction.id).eq('profile_id', profileId);
  if (error) return response.status(500).json({ error: error.message });
  response.sendStatus(204);
});

app.get('/api/dashboard', async (request, response) => {
  let query = supabase.from('transactions').select('*').order('date', { ascending: false });
  query = query.eq('profile_id', appProfileId(request));
  if (typeof request.query.from === 'string') query = query.gte('date', request.query.from);
  if (typeof request.query.to === 'string') query = query.lte('date', request.query.to);
  const { data: transactions, error } = await query;
  if (error) return response.status(500).json({ error: error.message });
  const profileId = appProfileId(request);
  const [{ data: accounts, error: accountsError }, { data: cards, error: cardsError }, { data: connections, error: connectionsError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, balance, currency_code, last_synced_at, external_account_id').eq('profile_id', profileId).order('name'),
    supabase.from('cards').select('id, name, brand, last_four, credit_limit, available_limit, last_synced_at, source').eq('profile_id', profileId).order('name'),
    supabase.from('open_finance_connections').select('id, status, institution_name, institution_logo_url, last_successful_sync_at, last_error').eq('profile_id', profileId).is('disconnected_at', null).order('created_at', { ascending: false }),
    supabase.from('profiles').select('open_finance_paused, open_finance_paused_at, manual_cycle_month, manual_cycle_opening_balance').eq('id', profileId).single()
  ]);
  if (accountsError || cardsError || connectionsError || profileError) return response.status(500).json({ error: accountsError?.message ?? cardsError?.message ?? connectionsError?.message ?? profileError?.message });
  let manualProfile = profile;
  try { if (profile?.open_finance_paused) manualProfile = await ensureManualMonth(profileId); } catch (cycleError) { return response.status(500).json({ error: cycleError instanceof Error ? cycleError.message : 'Não foi possível fechar o mês manual.' }); }
  const cycleStart = manualProfile?.open_finance_paused ? `${manualProfile.manual_cycle_month ?? currentMonth()}-01` : undefined;
  const cycleTransactions = manualProfile?.open_finance_paused && cycleStart ? transactions.filter(transaction => transaction.source === 'manual' && transaction.date >= cycleStart) : transactions;
  const recordedIncome = cycleTransactions.filter((transaction) => transaction.kind === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const expenses = cycleTransactions.filter((transaction) => transaction.kind === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const balance = manualProfile?.open_finance_paused ? (accounts ?? []).filter(account => !account.external_account_id).reduce((sum, account) => sum + Number(account.balance), 0) : (accounts ?? []).reduce((sum, account) => sum + Number(account.balance), 0);
  const paidFromAccounts = cycleTransactions.filter(transaction => transaction.kind === 'expense' && transaction.account_id).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const income = manualProfile?.open_finance_paused ? Math.max(0, balance - Number(manualProfile.manual_cycle_opening_balance ?? balance) + paidFromAccounts) : recordedIncome;
  const categoryTotals = new Map<string, number>();
  const monthly = new Map<string, { income: number; expenses: number }>();
  for (const transaction of cycleTransactions) {
    if (transaction.kind === 'expense') categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + Number(transaction.amount));
    const key = transaction.date.slice(0, 7);
    const value = monthly.get(key) ?? { income: 0, expenses: 0 };
    value[transaction.kind === 'income' ? 'income' : 'expenses'] += Number(transaction.amount);
    monthly.set(key, value);
  }
  if (manualProfile?.open_finance_paused) {
    const value = monthly.get(currentMonth()) ?? { income: 0, expenses: 0 };
    value.income = income;
    monthly.set(currentMonth(), value);
  }
  const categories = [...categoryTotals].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amount]) => ({ name, amount, percent: expenses ? Math.round(amount / expenses * 100) : 0 }));
  const chart = [...monthly].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([month, value]) => ({ month, ...value }));
  response.json({ balance, income, expenses, transactions: cycleTransactions, accounts, cards, connections, categories, chart });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Fycash API running at http://localhost:${port}`);
  });
}

export default app;

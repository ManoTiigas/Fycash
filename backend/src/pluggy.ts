import { supabase } from './supabase.js';

const baseUrl = 'https://api.pluggy.ai';
let cachedApiKey: { value: string; expiresAt: number } | undefined;

type PluggyAccount = { id: string; name?: string; marketingName?: string; type?: string; balance?: number; currencyCode?: string; creditData?: { creditLimit?: number; availableCreditLimit?: number; brand?: string; number?: string } };
type PluggyTransaction = { id: string; date: string; description?: string; amount: number; type?: string; category?: string | { name?: string } };
type PluggyItem = { id: string; clientUserId?: string; connector?: { name?: string; imageUrl?: string } };
type SyncTrigger = 'connect' | 'manual' | 'webhook';
type StoredCard = { id: string; external_account_id: string | null; name: string; brand: string | null; last_four: string | null };

function config() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET são obrigatórios.');
  return { clientId, clientSecret };
}

async function apiKey() {
  if (cachedApiKey && cachedApiKey.expiresAt > Date.now()) return cachedApiKey.value;
  const { clientId, clientSecret } = config();
  const response = await fetch(`${baseUrl}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
  if (!response.ok) throw new Error(`Falha na autenticação Pluggy (${response.status}).`);
  const data = await response.json() as { accessToken?: string };
  if (!data.accessToken) throw new Error('A Pluggy não retornou uma chave de acesso.');
  cachedApiKey = { value: data.accessToken, expiresAt: Date.now() + 105 * 60_000 };
  return data.accessToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey(), ...init?.headers } });
  if (!response.ok) throw new Error(`Falha na API Pluggy (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function createConnectToken(profileId: string) {
  const webhookUrl = process.env.PLUGGY_WEBHOOK_URL;
  const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
  const safeWebhookUrl = webhookUrl && webhookSecret ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(webhookSecret)}` : undefined;
  const data = await request<{ accessToken?: string }>('/connect_token', { method: 'POST', body: JSON.stringify({ options: { clientUserId: profileId, avoidDuplicates: true, ...(safeWebhookUrl ? { webhookUrl: safeWebhookUrl } : {}) } }) });
  if (!data.accessToken) throw new Error('A Pluggy não retornou o token do Connect.');
  return data.accessToken;
}

const accountType = (type?: string) => type?.toLowerCase() === 'credit' ? 'credit' : type?.toLowerCase() === 'savings' ? 'savings' : type?.toLowerCase() === 'investment' ? 'investment' : 'checking';
const transactionKind = (transaction: PluggyTransaction) => transaction.type?.toUpperCase() === 'CREDIT' ? 'income' : transaction.type?.toUpperCase() === 'DEBIT' ? 'expense' : transaction.amount < 0 ? 'expense' : 'income';
const categoryName = (category: PluggyTransaction['category']) => typeof category === 'string' ? category : category?.name ?? 'Sem categoria';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function cardInvoicePayment(transaction: PluggyTransaction, cards: StoredCard[]) {
  if (transactionKind(transaction) !== 'expense') return undefined;
  const description = normalize(`${transaction.description ?? ''} ${categoryName(transaction.category)}`);
  if (!/(pagamento|paga|quitacao|quitada).*(fatura|cartao)|(fatura|cartao).*(pagamento|paga|quitacao|quitada)/.test(description)) return undefined;
  const matches = cards.filter((card) => {
    const name = normalize(card.name); const brand = normalize(card.brand ?? ''); const lastFour = card.last_four?.trim();
    return (name.length > 2 && description.includes(name)) || (brand.length > 2 && description.includes(brand)) || Boolean(lastFour && new RegExp(`\\b${lastFour}\\b`).test(description));
  });
  return matches.length === 1 ? matches[0] : cards.length === 1 ? cards[0] : undefined;
}

async function transactionsForAccount(accountId: string) {
  const transactions: PluggyTransaction[] = [];
  let path: string | undefined = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
  while (path) {
    const page: { results?: PluggyTransaction[]; next?: string } = await request(path);
    transactions.push(...(page.results ?? []));
    path = page.next;
  }
  return transactions;
}

async function assertItemOwner(itemId: string, profileId: string) {
  const item = await request<PluggyItem>(`/items/${encodeURIComponent(itemId)}`);
  if (!item.clientUserId || item.clientUserId !== profileId) throw new Error('Este item Open Finance não pertence ao usuário autenticado.');
  return item;
}

export async function syncPluggyItem(itemId: string, profileId: string, trigger: SyncTrigger = 'manual') {
  const item = await assertItemOwner(itemId, profileId);
  const connectionResult = await supabase.from('open_finance_connections').upsert({ profile_id: profileId, provider: 'pluggy', external_item_id: itemId, status: 'SYNCING', disconnected_at: null, connector_name: item.connector?.name ?? null, institution_name: item.connector?.name ?? null, institution_logo_url: item.connector?.imageUrl ?? null }, { onConflict: 'external_item_id' }).select('id').single();
  if (connectionResult.error) throw connectionResult.error;
  const connection = connectionResult.data;
  const syncRun = await supabase.from('open_finance_sync_runs').insert({ profile_id: profileId, connection_id: connection.id, external_item_id: itemId, trigger, status: 'RUNNING' }).select('id').single();
  if (syncRun.error) throw syncRun.error;

  try {
    const { results: remoteAccounts = [] } = await request<{ results?: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    const mappedAccounts = remoteAccounts.map((account) => ({ profile_id: profileId, connection_id: connection.id, external_account_id: account.id, name: account.marketingName || account.name || 'Conta bancária', type: accountType(account.type), balance: Number(account.balance ?? 0), currency_code: account.currencyCode ?? 'BRL', last_synced_at: new Date().toISOString() }));
    let transactionsSynced = 0;
    if (mappedAccounts.length) {
      const stored = await supabase.from('accounts').upsert(mappedAccounts, { onConflict: 'external_account_id' }).select('id, external_account_id, name, type');
      if (stored.error) throw stored.error;
      const remoteById = new Map(remoteAccounts.map(account => [account.id, account]));
      const cardsByAccount = new Map<string, StoredCard>();
      for (const account of stored.data.filter((candidate) => candidate.type === 'credit')) {
        const remoteAccount = remoteById.get(account.external_account_id);
        const credit = remoteAccount?.creditData;
        const card = await supabase.from('cards').upsert({ profile_id: profileId, account_id: account.id, external_account_id: account.external_account_id, source: 'pluggy', name: account.name, brand: credit?.brand ?? null, last_four: credit?.number?.slice(-4) ?? null, credit_limit: Number(credit?.creditLimit ?? 0), available_limit: Number(credit?.availableCreditLimit ?? 0), last_synced_at: new Date().toISOString() }, { onConflict: 'external_account_id' }).select('id, external_account_id, name, brand, last_four').single();
        if (card.error) throw card.error;
        cardsByAccount.set(account.external_account_id, card.data);
      }
      const connectedCards = [...cardsByAccount.values()];
      for (const account of stored.data) {
        const remoteTransactions = await transactionsForAccount(account.external_account_id);
        const mappedTransactions = remoteTransactions.map((transaction) => {
          const kind = transactionKind(transaction);
          const cardFromTransaction = cardsByAccount.get(account.external_account_id);
          const paidCard = account.type === 'credit' ? undefined : cardInvoicePayment(transaction, connectedCards);
          const card = cardFromTransaction ?? paidCard;
          const isInvoicePayment = Boolean(paidCard);
          return { profile_id: profileId, account_id: account.id, card_id: card?.id ?? null, external_transaction_id: transaction.id, source: 'pluggy', member: item.connector?.name ?? 'Banco', date: transaction.date.slice(0, 10), description: transaction.description || 'Transação bancária', status: kind === 'income' ? 'Recebido' : 'Enviado', category: isInvoicePayment ? 'Pagamento de fatura' : categoryName(transaction.category), account: account.name, invoice: kind === 'income' ? 'Receita' : isInvoicePayment ? 'Fatura paga' : 'Paga', amount: Math.abs(Number(transaction.amount)), kind };
        });
        if (mappedTransactions.length) {
          const transactionResult = await supabase.from('transactions').upsert(mappedTransactions, { onConflict: 'external_transaction_id' }).select('id');
          if (transactionResult.error) throw transactionResult.error;
          transactionsSynced += transactionResult.data.length;
        }
      }
    }
    const now = new Date().toISOString();
    const result = await supabase.from('open_finance_connections').update({ status: 'SYNCED', last_synced_at: now, last_successful_sync_at: now, last_error: null }).eq('id', connection.id);
    if (result.error) throw result.error;
    await supabase.from('open_finance_sync_runs').update({ status: 'SUCCEEDED', accounts_synced: mappedAccounts.length, transactions_synced: transactionsSynced, finished_at: now }).eq('id', syncRun.data.id);
    return { itemId, accounts: mappedAccounts.length, transactions: transactionsSynced, status: 'SYNCED' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro de sincronização';
    await Promise.all([supabase.from('open_finance_connections').update({ status: 'ERROR', last_error: message }).eq('id', connection.id), supabase.from('open_finance_sync_runs').update({ status: 'FAILED', error_message: message, finished_at: new Date().toISOString() }).eq('id', syncRun.data.id)]);
    throw error;
  }
}

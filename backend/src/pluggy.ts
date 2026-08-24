import { supabase } from './supabase.js';

const baseUrl = 'https://api.pluggy.ai';
let cachedApiKey: { value: string; expiresAt: number } | undefined;

type PluggyAccount = { id: string; name?: string; marketingName?: string; type?: string; balance?: number; currencyCode?: string };
type PluggyTransaction = { id: string; date: string; description?: string; amount: number; type?: string; category?: string | { name?: string } };

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
  const response = await fetch(path.startsWith('http') ? path : `${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey(), ...init?.headers }
  });
  if (!response.ok) throw new Error(`Falha na API Pluggy (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function createConnectToken(profileId: string) {
  const webhookUrl = process.env.PLUGGY_WEBHOOK_URL;
  const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
  const safeWebhookUrl = webhookUrl && webhookSecret ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(webhookSecret)}` : undefined;
  const data = await request<{ accessToken?: string }>('/connect_token', {
    method: 'POST',
    body: JSON.stringify({ options: { clientUserId: profileId, avoidDuplicates: true, ...(safeWebhookUrl ? { webhookUrl: safeWebhookUrl } : {}) } })
  });
  if (!data.accessToken) throw new Error('A Pluggy não retornou o token do Connect.');
  return data.accessToken;
}

const accountType = (type?: string) => type?.toLowerCase() === 'credit' ? 'credit' : type?.toLowerCase() === 'savings' ? 'savings' : 'checking';
const transactionKind = (transaction: PluggyTransaction) => transaction.type?.toUpperCase() === 'CREDIT' || transaction.amount > 0 ? 'income' : 'expense';
const categoryName = (category: PluggyTransaction['category']) => typeof category === 'string' ? category : category?.name ?? 'Sem categoria';

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

export async function syncPluggyItem(itemId: string, profileId: string) {
  const connection = await supabase.from('open_finance_connections').upsert({ profile_id: profileId, provider: 'pluggy', external_item_id: itemId, status: 'SYNCING' }, { onConflict: 'external_item_id' }).select('id').single();
  if (connection.error) throw connection.error;

  try {
    const { results: remoteAccounts = [] } = await request<{ results?: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    const mappedAccounts = remoteAccounts.map((account) => ({
      profile_id: profileId, connection_id: connection.data.id, external_account_id: account.id,
      name: account.marketingName || account.name || 'Conta bancária', type: accountType(account.type),
      balance: Number(account.balance ?? 0), currency_code: account.currencyCode ?? 'BRL', last_synced_at: new Date().toISOString()
    }));
    if (mappedAccounts.length) {
      const stored = await supabase.from('accounts').upsert(mappedAccounts, { onConflict: 'external_account_id' }).select('id, external_account_id, name');
      if (stored.error) throw stored.error;
      for (const account of stored.data) {
        const remoteTransactions = await transactionsForAccount(account.external_account_id);
        const mappedTransactions = remoteTransactions.map((transaction) => {
          const kind = transactionKind(transaction);
          return { profile_id: profileId, account_id: account.id, external_transaction_id: transaction.id, source: 'pluggy', member: 'Banco', date: transaction.date.slice(0, 10), description: transaction.description || 'Transação bancária', status: kind === 'income' ? 'Recebido' : 'Enviado', category: categoryName(transaction.category), account: account.name, invoice: kind === 'income' ? 'Receita' : 'Paga', amount: Math.abs(Number(transaction.amount)), kind };
        });
        if (mappedTransactions.length) {
          const transactionResult = await supabase.from('transactions').upsert(mappedTransactions, { onConflict: 'external_transaction_id' });
          if (transactionResult.error) throw transactionResult.error;
        }
      }
    }
    const result = await supabase.from('open_finance_connections').update({ status: 'SYNCED', last_synced_at: new Date().toISOString(), last_error: null }).eq('id', connection.data.id);
    if (result.error) throw result.error;
    return { itemId, accounts: mappedAccounts.length, status: 'SYNCED' };
  } catch (error) {
    await supabase.from('open_finance_connections').update({ status: 'ERROR', last_error: error instanceof Error ? error.message : 'Erro de sincronização' }).eq('id', connection.data.id);
    throw error;
  }
}

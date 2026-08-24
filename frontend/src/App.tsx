import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarBlank, CaretDown, CaretLeft, CaretRight, ChartLineUp, CreditCard, Export, MagnifyingGlass, Plus, SlidersHorizontal, TrendDown, TrendUp, X } from '@phosphor-icons/react';
import { PluggyConnect, type ConnectEventPayload } from 'react-pluggy-connect';

type ApiTransaction = { id: string; member: string; date: string; description: string; status: string; category: string; account: string; invoice: string; amount: number; kind: 'income' | 'expense' };
type Account = { id: string; name: string; type: string; balance: number; currency_code: string; last_synced_at: string | null };
type DashboardCategory = { name: string; amount: number; percent: number };
type DashboardChart = { month: string; income: number; expenses: number };
type BankCard = { id: string; name: string; brand: string | null; last_four: string | null; credit_limit: number; available_limit: number };
type BankConnection = { id: string; status: string; institution_name: string | null; last_successful_sync_at: string | null; last_error: string | null };
type DashboardData = { balance: number; income: number; expenses: number; transactions: ApiTransaction[]; accounts: Account[]; categories: DashboardCategory[]; chart: DashboardChart[]; cards: BankCard[]; connections: BankConnection[] };
type NewTransaction = { description: string; amount: number; date: string; category: string; kind: 'income' | 'expense'; accountId?: string; account: string };

const money = (amount: number) => `R$ ${Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

function Calendar() {
  const [month, setMonth] = useState(new Date());
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: 35 }, (_, index) => index < first || index >= first + days ? '' : String(index - first + 1));
  }, [month]);
  const label = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return <section className="agenda"><h2><CalendarBlank /> Agenda</h2><div className="calendar-title"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior"><CaretLeft /></button><span>{label}</span><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês"><CaretRight /></button></div><div className="week">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <b key={day}>{day}</b>)}</div><div className="days">{cells.map((day, index) => <button disabled={!day} className={day === String(new Date().getDate()) ? 'day-active' : ''} key={`${day}-${index}`}>{day}</button>)}</div></section>;
}

function TransactionModal({ accounts, onClose, onSave }: { accounts: Account[]; onClose: () => void; onSave: (transaction: NewTransaction) => Promise<void> }) {
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('accountId') ?? '');
    const selectedAccount = accounts.find(account => account.id === accountId);
    const amount = Number(String(form.get('amount') ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return setError('Informe um valor maior que zero.');
    setSaving(true); setError('');
    try {
      await onSave({ description: String(form.get('description') ?? ''), amount, date: String(form.get('date') ?? today), category: String(form.get('category') ?? 'Sem categoria'), kind, accountId: accountId || undefined, account: selectedAccount?.name ?? 'Transação manual' });
      onClose();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Não foi possível criar a transação.'); }
    finally { setSaving(false); }
  }

  return <div className="transaction-modal-backdrop" role="presentation" onMouseDown={onClose}><form className="transaction-modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><h2>Nova transação</h2><p>Registre um lançamento manual.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X /></button></div><div className="kind-toggle"><button type="button" className={kind === 'expense' ? 'active expense' : ''} onClick={() => setKind('expense')}>Despesa</button><button type="button" className={kind === 'income' ? 'active income' : ''} onClick={() => setKind('income')}>Receita</button></div><label>Descrição<input name="description" placeholder="Ex.: Mercado" required autoFocus /></label><div className="modal-grid"><label>Valor<input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0,00" required /></label><label>Data<input name="date" type="date" defaultValue={today} required /></label></div><div className="modal-grid"><label>Categoria<input name="category" placeholder="Ex.: Alimentação" required /></label><label>Conta<select name="accountId" defaultValue=""><option value="">Transação manual</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label></div>{error && <p className="modal-error" role="alert">{error}</p>}<button className="modal-submit" disabled={saving} type="submit"><Plus />{saving ? 'Salvando...' : 'Adicionar transação'}</button></form></div>;
}

export default function App({ accessToken, onSignOut }: { accessToken: string; onSignOut: () => void }) {
  const [selected, setSelected] = useState(0);
  const [connectToken, setConnectToken] = useState<string>();
  const [connectionStatus, setConnectionStatus] = useState('');
  const [financialData, setFinancialData] = useState<DashboardData>();
  const [statementSearch, setStatementSearch] = useState('');
  const [statementKind, setStatementKind] = useState<'all' | 'income' | 'expense'>('all');
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000');
  const apiFetch = (path: string, init?: RequestInit) => fetch(`${apiUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers } });
  const chartData = financialData?.chart ?? [];
  const current = chartData[Math.min(selected, Math.max(chartData.length - 1, 0))];
  const max = Math.max(1, ...chartData.flatMap(item => [item.expenses, item.income]));

  async function loadDashboard() {
    const response = await apiFetch('/api/dashboard');
    if (!response.ok) throw new Error('Não foi possível atualizar o painel financeiro.');
    setFinancialData(await response.json() as DashboardData);
  }

  useEffect(() => { void loadDashboard().catch(error => setConnectionStatus(error instanceof Error ? error.message : 'Falha ao carregar os dados.')); }, []);
  useEffect(() => setSelected(Math.max(0, chartData.length - 1)), [financialData?.chart]);

  async function connectBank() {
    setConnectionStatus('Preparando conexão segura...');
    try {
      const response = await apiFetch('/api/open-finance/pluggy/connect-token', { method: 'POST' });
      const data = await response.json() as { connectToken?: string; error?: string };
      if (!response.ok || !data.connectToken) throw new Error(data.error ?? 'Não foi possível abrir a Pluggy.');
      setConnectToken(data.connectToken); setConnectionStatus('');
    } catch (error) { setConnectionStatus(error instanceof Error ? error.message : 'Falha ao iniciar a conexão.'); }
  }

  async function syncConnectedItem(payload: ConnectEventPayload) {
    const itemId = payload.item?.id;
    if (!itemId) return;
    setConnectionStatus('Sincronizando contas e transações...');
    try {
      const response = await apiFetch(`/api/open-finance/pluggy/items/${itemId}/sync`, { method: 'POST' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Falha ao sincronizar os dados.');
      await loadDashboard(); setConnectionStatus('Banco conectado e dados sincronizados.');
    } catch (error) { setConnectionStatus(error instanceof Error ? error.message : 'Falha ao sincronizar os dados.'); }
    finally { setConnectToken(undefined); }
  }

  async function createTransaction(transaction: NewTransaction) {
    const response = await apiFetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...transaction, member: 'Manual', status: transaction.kind === 'income' ? 'Recebido' : 'Enviado', invoice: transaction.kind === 'income' ? 'Receita' : 'Paga' }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível criar a transação.');
    await loadDashboard();
  }

  const transactions = financialData?.transactions ?? [];
  const filteredRows = transactions.filter(transaction => (statementKind === 'all' || transaction.kind === statementKind) && [transaction.member, transaction.description, transaction.category, transaction.account].join(' ').toLocaleLowerCase().includes(statementSearch.toLocaleLowerCase()));
  const exportCsv = () => {
    const content = [['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor'], ...filteredRows.map(transaction => [transaction.member, transaction.date, transaction.description, transaction.status, transaction.category, transaction.account, transaction.invoice, String(transaction.amount)])].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'extrato-fycash.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <main className="dashboard">
    <header className="topbar"><label className="search-box"><MagnifyingGlass /><input value={statementSearch} onChange={event => setStatementSearch(event.target.value)} placeholder="Pesquisar transações..." /></label><button className="round" aria-label="Filtros"><SlidersHorizontal /></button><button className="date-picker"><CalendarBlank /> Dados Open Finance <CaretDown /></button><div className="members"><span>m</span><span>x</span><span>s</span><button><Plus /></button></div><button className="connect-bank" onClick={connectBank}><CreditCard /> Conectar banco</button><button className="new-transaction" onClick={() => setNewTransactionOpen(true)}><Plus /> Nova Transação</button><button className="profile" onClick={() => { if (window.confirm('Deseja encerrar sua sessão neste dispositivo?')) onSignOut(); }} aria-label="Sair" title="Sair">TC</button></header>
    {connectionStatus && <p className="connection-status" role="status">{connectionStatus}</p>}
    {connectToken && <PluggyConnect connectToken={connectToken} includeSandbox={import.meta.env.VITE_PLUGGY_SANDBOX === 'true'} onSuccess={syncConnectedItem} onClose={() => setConnectToken(undefined)} onLoadError={error => setConnectionStatus(error.message)} />}
    {newTransactionOpen && <TransactionModal accounts={financialData?.accounts ?? []} onClose={() => setNewTransactionOpen(false)} onSave={createTransaction} />}

    <section className="overview"><div><section className="account-carousel" aria-label="Contas sincronizadas">{financialData?.accounts?.length ? financialData.accounts.map(account => <article className="account-card" key={account.id}><span>{account.type === 'credit' ? 'CR' : 'CC'}</span><p>{account.name}</p><strong>{money(account.balance)}</strong><small>{account.last_synced_at ? `Atualizado ${new Date(account.last_synced_at).toLocaleDateString('pt-BR')}` : 'Aguardando sincronização'}</small></article>) : <article className="account-card empty"><CreditCard /><p>Conecte uma instituição</p><small>Suas contas Open Finance aparecerão aqui.</small></article>}</section><section className="summary-grid"><article className="summary balance"><p>Saldo Total</p><strong>{money(financialData?.balance ?? 0)}</strong><small><TrendUp /> {financialData?.connections?.length ? `${financialData.connections.length} banco(s) conectado(s)` : 'Conecte seu banco'}</small></article><article className="summary"><p>Receitas <i><ArrowDownLeft /></i></p><strong>{money(financialData?.income ?? 0)}</strong><small><TrendUp /> Movimentações sincronizadas</small></article><article className="summary"><p>Despesas <i className="danger"><ArrowUpRight /></i></p><strong>{money(financialData?.expenses ?? 0)}</strong><small><TrendDown /> Movimentações sincronizadas</small></article></section></div><aside className="cards-panel"><h2><CreditCard /> Cartões</h2><div className="card-stack">{financialData?.cards?.length ? financialData.cards.map(card => <article className="inter" key={card.id}><span>{card.brand?.slice(0, 2).toUpperCase() ?? 'CC'}</span><b>{money(card.available_limit)}</b><small>{card.name}{card.last_four ? ` • ${card.last_four}` : ''}</small><strong>{money(card.credit_limit)}</strong></article>) : <p className="empty-copy">Nenhum cartão de crédito sincronizado.</p>}</div></aside></section>

    <section className="content-grid"><article className="finance-chart"><div className="section-title"><h2><ChartLineUp /> Fluxo Financeiro</h2><div className="legend"><span><i />Receitas</span><span><i />Despesas</span></div></div><p className="chart-value">{current ? <>{monthLabel(current.month)}: <b>{money(current.income)}</b> receitas · <b>{money(current.expenses)}</b> despesas</> : 'Conecte seu banco ou registre uma transação para visualizar o fluxo.'}</p><div className="bar-chart">{chartData.length ? <><div className="axis"><span>{money(max)}</span><span>{money(max / 2)}</span><span>R$ 0</span></div><div className="bars">{chartData.map((item, index) => <button className={`bar-group ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} key={item.month} aria-label={`Selecionar ${monthLabel(item.month)}`}><span className="bar-pair"><i className="expense" style={{ height: `${item.expenses / max * 100}%` }} /><i className="income" style={{ height: `${item.income / max * 100}%` }} /></span><b>{monthLabel(item.month)}</b></button>)}</div></> : <p className="chart-empty">Sem dados financeiros no período.</p>}</div></article><aside className="right-rail"><Calendar /><div className="empty-card" /></aside></section>

    <section className="statement"><div className="statement-top"><h2><Export /> Extrato Detalhado</h2><div><button onClick={exportCsv} disabled={!filteredRows.length}>Exportar CSV <Export /></button><label><MagnifyingGlass /><input value={statementSearch} onChange={event => setStatementSearch(event.target.value)} placeholder="Pesquisar..." /></label><button onClick={() => setStatementKind(currentKind => currentKind === 'all' ? 'income' : currentKind === 'income' ? 'expense' : 'all')}>{statementKind === 'all' ? 'Todos' : statementKind === 'income' ? 'Receitas' : 'Despesas'} <CaretDown /></button></div></div><div className="table-head">{['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor', ''].map((heading, index) => <span key={index}>{heading}</span>)}</div>{filteredRows.length ? filteredRows.map(transaction => <article className="table-row" key={transaction.id}><span><i />{transaction.member}</span><span>{new Date(`${transaction.date}T00:00:00`).toLocaleDateString('pt-BR')}</span><span>{transaction.description}</span><span>{transaction.status}</span><span>{transaction.category}</span><span>{transaction.account}</span><span>{transaction.invoice}</span><span>{money(transaction.amount)}</span><b className={transaction.kind === 'income' ? 'up' : 'down'}>{transaction.kind === 'income' ? <TrendUp /> : <TrendDown />}</b></article>) : <p className="statement-empty">Nenhuma transação Open Finance encontrada.</p>}</section>
  </main>;
}

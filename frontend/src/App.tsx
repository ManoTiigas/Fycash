import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarBlank, CaretDown, CaretLeft, CaretRight, ChartLineUp, CreditCard, Export, MagnifyingGlass, Plus, SlidersHorizontal, TrendDown, TrendUp, X } from '@phosphor-icons/react';
import { PluggyConnect, type ConnectEventPayload } from 'react-pluggy-connect';

type ApiTransaction = { id: string; member: string; date: string; description: string; status: string; category: string; account: string; invoice: string; amount: number; kind: 'income' | 'expense' };
type Account = { id: string; name: string; type: string; balance: number; currency_code: string; last_synced_at: string | null };
type DashboardCategory = { name: string; amount: number; percent: number };
type DashboardChart = { month: string; income: number; expenses: number };
type BankCard = { id: string; name: string; brand: string | null; last_four: string | null; credit_limit: number; available_limit: number };
type BankConnection = { id: string; status: string; institution_name: string | null; institution_logo_url: string | null; last_successful_sync_at: string | null; last_error: string | null };
type DashboardData = { balance: number; income: number; expenses: number; transactions: ApiTransaction[]; accounts: Account[]; categories: DashboardCategory[]; chart: DashboardChart[]; cards: BankCard[]; connections: BankConnection[] };
type NewTransaction = { description: string; amount: number; date: string; category: string; kind: 'income' | 'expense'; accountId?: string; account: string };
type ProfileData = { display_name: string; avatar_url: string | null; email: string | null };

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

function AccountModal({ onClose, onSave }: { onClose: () => void; onSave: (account: { name: string; type: string; balance: number }) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const balance = Number(String(form.get('balance') ?? '0').replace(',', '.')); setSaving(true); setError(''); try { await onSave({ name: String(form.get('name') ?? ''), type: String(form.get('type') ?? 'checking'), balance }); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a conta.'); } finally { setSaving(false); } }
  return <div className="transaction-modal-backdrop" role="presentation" onMouseDown={onClose}><form className="transaction-modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><h2>Conta manual</h2><p>Use sem conectar Open Finance.</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button></div><label>Nome da conta<input name="name" placeholder="Ex.: Carteira" required autoFocus maxLength={80} /></label><label>Tipo<select name="type" defaultValue="checking"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="investment">Investimento</option></select></label><label>Saldo inicial<input name="balance" type="number" step="0.01" defaultValue="0" required /></label>{error && <p className="modal-error" role="alert">{error}</p>}<button className="modal-submit" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar conta manual'}</button></form></div>;
}

function PrivacyConsentModal({ onClose, onAccept }: { onClose: () => void; onAccept: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit() { setSaving(true); setError(''); try { await onAccept(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o consentimento.'); } finally { setSaving(false); } }
  return <div className="transaction-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="transaction-modal privacy-modal" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><h2>Privacidade e Open Finance</h2><p>Seu consentimento é necessário antes da conexão bancária.</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button></div><p>Ao continuar, a Fycash acessará dados de contas, cartões e transações escolhidos por você na Pluggy para exibir suas finanças. Você pode revogar o consentimento nas configurações a qualquer momento.</p><label className="consent-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> Li e concordo com o tratamento destes dados para o Open Finance.</label>{error && <p className="modal-error" role="alert">{error}</p>}<button className="modal-submit" disabled={!accepted || saving} type="button" onClick={submit}>{saving ? 'Salvando...' : 'Concordar e conectar banco'}</button></section></div>;
}

function ProfileSettingsModal({ profile, connections, openFinanceConsent, onClose, onSave, onSignOut, onExport, onDeleteRequest, onRevokeConsent }: { profile: ProfileData | undefined; connections: BankConnection[]; openFinanceConsent: boolean; onClose: () => void; onSave: (name: string) => Promise<void>; onSignOut: () => void; onExport: () => Promise<void>; onDeleteRequest: () => Promise<void>; onRevokeConsent: () => Promise<void> }) {
  const [name, setName] = useState(profile?.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setName(profile?.display_name ?? ''), [profile?.display_name]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(name); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o perfil.'); } finally { setSaving(false); }
  }
  return <div className="transaction-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="transaction-modal profile-settings" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><h2>Configurações</h2><p>Perfil, segurança e Open Finance.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X /></button></div><form onSubmit={submit}><label>Nome de exibição<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label><label>E-mail<input value={profile?.email ?? ''} disabled aria-label="E-mail da conta" /></label>{error && <p className="modal-error" role="alert">{error}</p>}<button className="modal-submit" disabled={saving} type="submit">{saving ? 'Salvando...' : 'Salvar perfil'}</button></form><section className="settings-section"><h3>Open Finance</h3>{connections.length ? connections.map(connection => <p key={connection.id}><strong>{connection.institution_name ?? 'Banco conectado'}</strong><span>{connection.status === 'SYNCED' ? 'Sincronizado' : connection.status}</span></p>) : <p>Nenhum banco conectado.</p>}{openFinanceConsent && <button className="outline-button" type="button" onClick={() => { if (window.confirm('Revogar o consentimento desconectará seus bancos. Continuar?')) void onRevokeConsent(); }}>Revogar consentimento</button>}</section><section className="settings-section"><h3>Privacidade e LGPD</h3><p><strong>Portabilidade</strong><span>Baixe uma cópia dos seus dados.</span></p><button className="outline-button" type="button" onClick={() => void onExport()}>Exportar meus dados</button><button className="danger-button" type="button" onClick={() => { if (window.confirm('Enviar solicitação de exclusão dos seus dados?')) void onDeleteRequest(); }}>Solicitar exclusão de dados</button></section><section className="settings-section"><h3>Segurança</h3><p><strong>Sessão ativa</strong><span>Permanece conectada neste dispositivo.</span></p><button className="signout-button" type="button" onClick={() => { if (window.confirm('Deseja encerrar sua sessão neste dispositivo?')) onSignOut(); }}>Sair desta conta</button></section></section></div>;
}

export default function App({ accessToken, onSignOut }: { accessToken: string; onSignOut: () => void }) {
  const [selected, setSelected] = useState(0);
  const [connectToken, setConnectToken] = useState<string>();
  const [connectionStatus, setConnectionStatus] = useState('');
  const [financialData, setFinancialData] = useState<DashboardData>();
  const [statementSearch, setStatementSearch] = useState('');
  const [statementKind, setStatementKind] = useState<'all' | 'income' | 'expense'>('all');
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData>();
  const [openFinanceConsent, setOpenFinanceConsent] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000');
  const apiFetch = (path: string, init?: RequestInit) => fetch(`${apiUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers } });
  const chartData = financialData?.chart ?? [];
  const current = chartData[Math.min(selected, Math.max(chartData.length - 1, 0))];
  const max = Math.max(1, ...chartData.flatMap(item => [item.expenses, item.income]));
  const connectedBanks = (financialData?.connections ?? []).filter(connection => connection.status === 'SYNCED');

  async function loadDashboard() {
    const response = await apiFetch('/api/dashboard');
    if (!response.ok) throw new Error('Não foi possível atualizar o painel financeiro.');
    setFinancialData(await response.json() as DashboardData);
  }

  async function loadProfile() {
    const response = await apiFetch('/api/profile');
    if (!response.ok) throw new Error('Não foi possível carregar o perfil.');
    setProfile(await response.json() as ProfileData);
  }

  async function loadPrivacyConsent() {
    const response = await apiFetch('/api/privacy/consent');
    if (!response.ok) throw new Error('Não foi possível carregar as preferências de privacidade.');
    const data = await response.json() as { openFinanceConsent: boolean };
    setOpenFinanceConsent(data.openFinanceConsent);
  }

  useEffect(() => { void Promise.all([loadDashboard(), loadProfile(), loadPrivacyConsent()]).catch(error => setConnectionStatus(error instanceof Error ? error.message : 'Falha ao carregar os dados.')); }, []);
  useEffect(() => setSelected(Math.max(0, chartData.length - 1)), [financialData?.chart]);

  function connectBank() {
    if (!openFinanceConsent) { setPrivacyOpen(true); return; }
    void startBankConnection();
  }

  async function startBankConnection() {
    setConnectionStatus('Preparando conexão segura...');
    try {
      const response = await apiFetch('/api/open-finance/pluggy/connect-token', { method: 'POST' });
      const data = await response.json() as { connectToken?: string; error?: string };
      if (!response.ok || !data.connectToken) throw new Error(data.error ?? 'Não foi possível abrir a Pluggy.');
      setConnectToken(data.connectToken); setConnectionStatus('');
    } catch (error) { setConnectionStatus(error instanceof Error ? error.message : 'Falha ao iniciar a conexão.'); }
  }

  async function acceptPrivacyConsent() {
    const response = await apiFetch('/api/privacy/consent', { method: 'POST' });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível registrar o consentimento.');
    setOpenFinanceConsent(true); setPrivacyOpen(false); await startBankConnection();
  }

  async function exportPersonalData() {
    const response = await apiFetch('/api/privacy/export');
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível exportar seus dados.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'fycash-meus-dados.json'; link.click(); URL.revokeObjectURL(url);
  }

  async function requestDataDeletion() {
    const response = await apiFetch('/api/privacy/deletion-request', { method: 'POST' }); const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível enviar a solicitação.');
    setConnectionStatus('Solicitação de exclusão registrada.');
  }

  async function revokeOpenFinanceConsent() {
    const response = await apiFetch('/api/privacy/revoke-open-finance', { method: 'POST' });
    if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error ?? 'Não foi possível revogar o consentimento.'); }
    setOpenFinanceConsent(false); await loadDashboard(); setConnectionStatus('Consentimento revogado e bancos desconectados.');
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

  async function createManualAccount(account: { name: string; type: string; balance: number }) {
    const response = await apiFetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível criar a conta.');
    await loadDashboard();
  }

  async function updateProfile(displayName: string) {
    const response = await apiFetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
    const data = await response.json() as ProfileData & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível salvar o perfil.');
    setProfile(data);
  }

  const transactions = financialData?.transactions ?? [];
  const filteredRows = transactions.filter(transaction => (statementKind === 'all' || transaction.kind === statementKind) && [transaction.member, transaction.description, transaction.category, transaction.account].join(' ').toLocaleLowerCase().includes(statementSearch.toLocaleLowerCase()));
  const exportCsv = () => {
    const content = [['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor'], ...filteredRows.map(transaction => [transaction.member, transaction.date, transaction.description, transaction.status, transaction.category, transaction.account, transaction.invoice, String(transaction.amount)])].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'extrato-fycash.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <main className="dashboard">
    <header className="topbar"><label className="search-box"><MagnifyingGlass /><input value={statementSearch} onChange={event => setStatementSearch(event.target.value)} placeholder="Pesquisar transações..." /></label><button className="round" aria-label="Filtros"><SlidersHorizontal /></button><button className="date-picker"><CalendarBlank /> Dados Open Finance <CaretDown /></button><div className="members" aria-label="Bancos conectados">{connectedBanks.slice(0, 3).map(bank => <span className="bank-avatar" key={bank.id} title={bank.institution_name ?? 'Banco conectado'}>{bank.institution_logo_url ? <img src={bank.institution_logo_url} alt="" /> : (bank.institution_name ?? 'B').slice(0, 2).toUpperCase()}</span>)}<button onClick={connectBank} aria-label="Conectar banco com Open Finance" title="Conectar banco"><Plus /></button></div><button className="new-transaction" onClick={() => setNewTransactionOpen(true)}><Plus /> Nova Transação</button><button className="profile" onClick={() => setProfileOpen(true)} aria-label="Abrir configurações" title="Configurações">{profile?.display_name?.slice(0, 2).toUpperCase() ?? 'TC'}</button></header>
    {connectionStatus && <p className="connection-status" role="status">{connectionStatus}</p>}
    {connectToken && <PluggyConnect connectToken={connectToken} includeSandbox={import.meta.env.VITE_PLUGGY_SANDBOX === 'true'} onSuccess={syncConnectedItem} onClose={() => setConnectToken(undefined)} onLoadError={error => setConnectionStatus(error.message)} />}
    {newTransactionOpen && <TransactionModal accounts={financialData?.accounts ?? []} onClose={() => setNewTransactionOpen(false)} onSave={createTransaction} />}
    {newAccountOpen && <AccountModal onClose={() => setNewAccountOpen(false)} onSave={createManualAccount} />}
    {privacyOpen && <PrivacyConsentModal onClose={() => setPrivacyOpen(false)} onAccept={acceptPrivacyConsent} />}
    {profileOpen && <ProfileSettingsModal profile={profile} connections={financialData?.connections ?? []} openFinanceConsent={openFinanceConsent} onClose={() => setProfileOpen(false)} onSave={updateProfile} onSignOut={onSignOut} onExport={exportPersonalData} onDeleteRequest={requestDataDeletion} onRevokeConsent={revokeOpenFinanceConsent} />}

    <section className="overview"><div><section className="account-carousel" aria-label="Contas">{financialData?.accounts?.map(account => <article className="account-card" key={account.id}><span>{account.type === 'credit' ? 'CR' : 'CC'}</span><p>{account.name}</p><strong>{money(account.balance)}</strong><small>{account.last_synced_at ? `Atualizado ${new Date(account.last_synced_at).toLocaleDateString('pt-BR')}` : 'Conta manual'}</small></article>)}<button className="account-card add-account" onClick={() => setNewAccountOpen(true)}><Plus /><strong>Adicionar conta</strong><small>Manual ou Open Finance</small></button></section><section className="summary-grid"><article className="summary balance"><p>Saldo Total</p><strong>{money(financialData?.balance ?? 0)}</strong><small><TrendUp /> {financialData?.connections?.length ? `${financialData.connections.length} banco(s) conectado(s)` : 'Conecte seu banco'}</small></article><article className="summary"><p>Receitas <i><ArrowDownLeft /></i></p><strong>{money(financialData?.income ?? 0)}</strong><small><TrendUp /> Movimentações sincronizadas</small></article><article className="summary"><p>Despesas <i className="danger"><ArrowUpRight /></i></p><strong>{money(financialData?.expenses ?? 0)}</strong><small><TrendDown /> Movimentações sincronizadas</small></article></section></div><aside className="cards-panel"><h2><CreditCard /> Cartões</h2><div className="card-stack">{financialData?.cards?.length ? financialData.cards.map(card => <article className="inter" key={card.id}><span>{card.brand?.slice(0, 2).toUpperCase() ?? 'CC'}</span><b>{money(card.available_limit)}</b><small>{card.name}{card.last_four ? ` • ${card.last_four}` : ''}</small><strong>{money(card.credit_limit)}</strong></article>) : <p className="empty-copy">Nenhum cartão de crédito sincronizado.</p>}</div></aside></section>

    <section className="content-grid"><article className="finance-chart"><div className="section-title"><h2><ChartLineUp /> Fluxo Financeiro</h2><div className="legend"><span><i />Receitas</span><span><i />Despesas</span></div></div><p className="chart-value">{current ? <>{monthLabel(current.month)}: <b>{money(current.income)}</b> receitas · <b>{money(current.expenses)}</b> despesas</> : 'Conecte seu banco ou registre uma transação para visualizar o fluxo.'}</p><div className="bar-chart">{chartData.length ? <><div className="axis"><span>{money(max)}</span><span>{money(max / 2)}</span><span>R$ 0</span></div><div className="bars">{chartData.map((item, index) => <button className={`bar-group ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} key={item.month} aria-label={`Selecionar ${monthLabel(item.month)}`}><span className="bar-pair"><i className="expense" style={{ height: `${item.expenses / max * 100}%` }} /><i className="income" style={{ height: `${item.income / max * 100}%` }} /></span><b>{monthLabel(item.month)}</b></button>)}</div></> : <p className="chart-empty">Sem dados financeiros no período.</p>}</div></article><aside className="right-rail"><Calendar /><div className="empty-card" /></aside></section>

    <section className="statement"><div className="statement-top"><h2><Export /> Extrato Detalhado</h2><div><button onClick={exportCsv} disabled={!filteredRows.length}>Exportar CSV <Export /></button><label><MagnifyingGlass /><input value={statementSearch} onChange={event => setStatementSearch(event.target.value)} placeholder="Pesquisar..." /></label><button onClick={() => setStatementKind(currentKind => currentKind === 'all' ? 'income' : currentKind === 'income' ? 'expense' : 'all')}>{statementKind === 'all' ? 'Todos' : statementKind === 'income' ? 'Receitas' : 'Despesas'} <CaretDown /></button></div></div><div className="table-head">{['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor', ''].map((heading, index) => <span key={index}>{heading}</span>)}</div>{filteredRows.length ? filteredRows.map(transaction => <article className="table-row" key={transaction.id}><span><i />{transaction.member}</span><span>{new Date(`${transaction.date}T00:00:00`).toLocaleDateString('pt-BR')}</span><span>{transaction.description}</span><span>{transaction.status}</span><span>{transaction.category}</span><span>{transaction.account}</span><span>{transaction.invoice}</span><span>{money(transaction.amount)}</span><b className={transaction.kind === 'income' ? 'up' : 'down'}>{transaction.kind === 'income' ? <TrendUp /> : <TrendDown />}</b></article>) : <p className="statement-empty">Nenhuma transação Open Finance encontrada.</p>}</section>
  </main>;
}

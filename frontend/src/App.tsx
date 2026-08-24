import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarBlank, CaretDown, CaretLeft, CaretRight, ChartLineUp, CreditCard, Export, MagnifyingGlass, Plus, SlidersHorizontal, TrendDown, TrendUp } from '@phosphor-icons/react';
import { PluggyConnect, type ConnectEventPayload } from 'react-pluggy-connect';

const categories = [['Moradia', 'R$ 1.200,00', 14, '#08b777'], ['Compras', 'R$ 1.200,00', 14, '#000'], ['Alimentação', 'R$ 1.156,50', 14, '#9698a4'], ['Lazer', 'R$ 351,70', 4, '#c9c9d3']];
const chart = [{ month: 'Jan', expenses: 5400, income: 6700 }, { month: 'Fev', expenses: 7100, income: 5700 }, { month: 'Mar', expenses: 5900, income: 2500 }, { month: 'Abr', expenses: 3200, income: 800 }, { month: 'Jun', expenses: 6800, income: 5100 }, { month: 'Jul', expenses: 2500, income: 5900 }, { month: 'Ago', expenses: 4200, income: 8200 }];
const sampleTransactions = [['Val Cow...', '22 Dec. 2026', 'Pix venda de site para a ...', 'Recebido', 'Pix', '-', 'Receita', '5.000,00', true], ['Nubank', '19 Dec. 2026', 'Fatura do cartão de credi...', 'Enviado', 'Pix', 'Conta', 'Paga', '10.000,00', false], ['Mercado P...', '18 Dec. 2026', 'Pagamento de Plano Anu...', 'Recebido', 'Pix', '-', 'Receita', '8.000,00', true], ['Nubank', '15 Dec. 2026', 'Pagamento Plano de IA’s', 'Enviado', 'Cartão', 'Conta', 'Paga', '870,00', false], ['NG Net LTDA', '19 Nov. 2026', 'Pagamento provedora de ...', 'Enviado', 'Pix', 'Conta', 'Paga', '150,00', false]];
type ApiTransaction = { id: string; member: string; date: string; description: string; status: string; category: string; account: string; invoice: string; amount: number; kind: 'income' | 'expense' };
type DashboardCategory = { name: string; amount: number; percent: number };
type DashboardChart = { month: string; income: number; expenses: number };
type BankCard = { id: string; name: string; brand: string | null; last_four: string | null; credit_limit: number; available_limit: number };
type BankConnection = { id: string; status: string; institution_name: string | null; last_successful_sync_at: string | null; last_error: string | null };
type DashboardData = { balance: number; income: number; expenses: number; transactions: ApiTransaction[]; categories: DashboardCategory[]; chart: DashboardChart[]; cards: BankCard[]; connections: BankConnection[] };
const money = (amount: number) => `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Calendar() {
  const [month, setMonth] = useState(new Date(2026, 11, 1));
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: 35 }, (_, index) => index < first || index >= first + days ? '' : String(index - first + 1));
  }, [month]);
  const label = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return <section className="agenda"><h2><CalendarBlank /> Agenda</h2><div className="calendar-title"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior"><CaretLeft /></button><span>{label}</span><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês"><CaretRight /></button></div><div className="week">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <b key={day}>{day}</b>)}</div><div className="days">{cells.map((day, index) => <button disabled={!day} className={day === '1' ? 'day-active' : ''} key={`${day}-${index}`}>{day}</button>)}</div></section>;
}

export default function App({ accessToken, onSignOut }: { accessToken: string; onSignOut: () => void }) {
  const [selected, setSelected] = useState(chart.length - 1);
  const [connectToken, setConnectToken] = useState<string>();
  const [connectionStatus, setConnectionStatus] = useState('');
  const [financialData, setFinancialData] = useState<DashboardData>();
  const [statementSearch, setStatementSearch] = useState('');
  const [statementKind, setStatementKind] = useState<'all' | 'income' | 'expense'>('all');
  const chartData = financialData?.chart?.length ? financialData.chart : chart;
  const categoryData = financialData?.categories?.length ? financialData.categories : categories.map(([name, amount, percent]) => ({ name: name as string, amount: Number(String(amount).replace(/[^\d,]/g, '').replace(',', '.')), percent: percent as number }));
  const current = chartData[Math.min(selected, chartData.length - 1)];
  const max = Math.max(1, ...chartData.flatMap(item => [item.expenses, item.income]));
  const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000');
  const apiFetch = (path: string, init?: RequestInit) => fetch(`${apiUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers } });

  async function loadDashboard() {
    const response = await apiFetch('/api/dashboard');
    if (!response.ok) throw new Error('Não foi possível atualizar o painel financeiro.');
    setFinancialData(await response.json() as DashboardData);
  }

  useEffect(() => { void loadDashboard().catch(() => undefined); }, []);
  useEffect(() => setSelected(Math.max(0, chartData.length - 1)), [financialData?.chart]);

  async function connectBank() {
    setConnectionStatus('Preparando conexão segura...');
    try {
      const response = await apiFetch('/api/open-finance/pluggy/connect-token', { method: 'POST' });
      const data = await response.json() as { connectToken?: string; error?: string };
      if (!response.ok || !data.connectToken) throw new Error(data.error ?? 'Não foi possível abrir a Pluggy.');
      setConnectToken(data.connectToken);
      setConnectionStatus('');
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
      await loadDashboard();
      setConnectionStatus('Banco conectado e dados sincronizados.');
    } catch (error) { setConnectionStatus(error instanceof Error ? error.message : 'Falha ao sincronizar os dados.'); } finally { setConnectToken(undefined); }
  }

  const tableRows = financialData ? financialData.transactions.map((transaction) => [transaction.member, new Date(`${transaction.date}T00:00:00`).toLocaleDateString('pt-BR'), transaction.description, transaction.status, transaction.category, transaction.account, transaction.invoice, transaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), transaction.kind === 'income']) : sampleTransactions;
  const filteredRows = tableRows.filter(row => (statementKind === 'all' || (row[8] ? 'income' : 'expense') === statementKind) && [row[0], row[2], row[4], row[5]].join(' ').toLocaleLowerCase().includes(statementSearch.toLocaleLowerCase()));
  const exportCsv = () => {
    const content = [['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor'], ...filteredRows.map(row => row.slice(0, 8).map(String))].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'extrato-fycash.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <main className="dashboard">
    <header className="topbar"><label className="search-box"><MagnifyingGlass /><input placeholder="Pesquisar..." /></label><button className="round" aria-label="Filtros"><SlidersHorizontal /></button><button className="date-picker"><CalendarBlank /> 01 dez - 31 dez, 2026 <CaretDown /></button><div className="members"><span>m</span><span>x</span><span>s</span><button><Plus /></button></div><button className="connect-bank" onClick={connectBank}><CreditCard /> Conectar banco</button><button className="new-transaction"><Plus /> Nova Transação</button><button className="profile" onClick={() => { if (window.confirm('Deseja encerrar sua sessão neste dispositivo?')) onSignOut(); }} aria-label="Sair" title="Sair">TC</button></header>
    {connectionStatus && <p className="connection-status" role="status">{connectionStatus}</p>}
    {connectToken && <PluggyConnect connectToken={connectToken} includeSandbox={import.meta.env.VITE_PLUGGY_SANDBOX === 'true'} onSuccess={syncConnectedItem} onClose={() => setConnectToken(undefined)} onLoadError={(error) => setConnectionStatus(error.message)} />}
    <section className="overview"><div><section className="categories">{categoryData.map((category, index) => { const colors = ['#08b777', '#000', '#9698a4', '#c9c9d3']; return <article className="category" key={category.name}><div className="donut" style={{ background: `conic-gradient(${colors[index % colors.length]} 0 ${category.percent * 3.6}deg, #dfdfe4 ${category.percent * 3.6}deg 360deg)` }}><b>{category.percent}%</b></div><p>{category.name}</p><strong>{money(category.amount)}</strong></article>; })}</section><section className="summary-grid"><article className="summary balance"><p>Saldo Total</p><strong>{money(financialData?.balance ?? 4156.4)}</strong><small><TrendUp /> {financialData?.connections?.length ? `${financialData.connections.length} banco(s) conectado(s)` : 'Conecte seu banco'}</small></article><article className="summary"><p>Receitas <i><ArrowDownLeft /></i></p><strong>{money(financialData?.income ?? 8500)}</strong><small><TrendUp /> Dados sincronizados</small></article><article className="summary"><p>Despesas <i className="danger"><ArrowUpRight /></i></p><strong>{money(financialData?.expenses ?? 4343.6)}</strong><small><TrendDown /> Dados do período</small></article></section></div><aside className="cards-panel"><h2><CreditCard /> Cartões</h2><div className="card-stack">{financialData?.cards?.length ? financialData.cards.slice(0, 3).map((card, index) => <article className={index === 2 ? 'inter' : ''} key={card.id}><span>{card.brand?.slice(0, 2) ?? 'CC'}</span><b>{money(card.available_limit)}</b><small>{card.name}{card.last_four ? ` • ${card.last_four}` : ''}</small><strong>{money(card.credit_limit)}</strong></article>) : <p>Nenhum cartão sincronizado.</p>}</div></aside></section>
    <section className="content-grid"><article className="finance-chart"><div className="section-title"><h2><ChartLineUp /> Fluxo Financeiro</h2><div className="legend"><span><i />Receitas</span><span><i />Despesas</span></div></div><p className="chart-value">{current ? <>{current.month}: <b>{money(current.income)}</b> receitas · <b>{money(current.expenses)}</b> despesas</> : 'Sem movimentações no período.'}</p><div className="bar-chart"><div className="axis"><span>R$ 10k</span><span>R$ 5k</span><span>R$ 1k</span><span>R$ 0</span></div><div className="bars">{chartData.map((item, index) => <button className={`bar-group ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} key={item.month} aria-label={`Selecionar ${item.month}`}><span className="bar-pair"><i className="expense" style={{ height: `${item.expenses / max * 100}%` }} /><i className="income" style={{ height: `${item.income / max * 100}%` }} /></span><b>{item.month}</b></button>)}</div></div></article><aside className="right-rail"><Calendar /><div className="empty-card" /></aside></section>
    <section className="statement"><div className="statement-top"><h2><Export /> Extrato Detalhado</h2><div><button onClick={exportCsv}>Exportar CSV <Export /></button><label><MagnifyingGlass /><input value={statementSearch} onChange={event => setStatementSearch(event.target.value)} placeholder="Pesquisar..." /></label><button onClick={() => setStatementKind(currentKind => currentKind === 'all' ? 'income' : currentKind === 'income' ? 'expense' : 'all')}>{statementKind === 'all' ? 'Todos' : statementKind === 'income' ? 'Receitas' : 'Despesas'} <CaretDown /></button></div></div><div className="table-head">{['Membro', 'Data', 'Descrição', 'Status', 'Categoria', 'Conta/Cartão', 'Fatura', 'Valor', ''].map((heading, index) => <span key={index}>{heading}</span>)}</div>{filteredRows.map(row => <article className="table-row" key={`${row[0]}-${row[1]}-${row[2]}`}><span><i />{row[0] as string}</span>{row.slice(1, 8).map((cell, index) => <span key={index}>{cell as string}</span>)}<b className={row[8] ? 'up' : 'down'}>{row[8] ? <TrendUp /> : <TrendDown />}</b></article>)}</section>
  </main>;
}

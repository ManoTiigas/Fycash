export type StatementTransaction = {
  date: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
  provider: 'nubank' | 'mercado_pago' | 'generic';
};

export type ParsedStatement = { provider: StatementTransaction['provider']; transactions: StatementTransaction[] };

const normalizeAmount = (value: string) => Number(value.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const unique = (transactions: StatementTransaction[]) => [...new Map(transactions.map(transaction => [`${transaction.date}|${transaction.description.toLowerCase()}|${transaction.amount}|${transaction.kind}`, transaction])).values()];
const monthNumbers: Record<string, string> = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };

function parseNubank(text: string): StatementTransaction[] {
  const transactions: StatementTransaction[] = [];
  let date = '';
  let description: string[] = [];
  let ignoreFooter = false;
  const flush = (amountText: string) => {
    const amount = Math.abs(normalizeAmount(amountText));
    const value = description.join(' ').replace(/\s+/g, ' ').trim();
    description = [];
    if (!date || !value || !Number.isFinite(amount) || amount <= 0 || /^(total|saldo|valores em|movimenta[çc][õo]es)/i.test(value)) return;
    transactions.push({ date, description: value.slice(0, 200), amount, kind: /transfer[êe]ncia recebida|pix recebido|rendimento/i.test(value) ? 'income' : 'expense', provider: 'nubank' });
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const heading = line.match(/^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})$/i);
    if (heading) { date = `${heading[3]}-${monthNumbers[heading[2].toUpperCase()]}-${heading[1]}`; description = []; ignoreFooter = false; continue; }
    if (/^(tem alguma d[úu]vida|caso a solu[çc][ãa]o|extrato gerado|o saldo l[ií]quido|n[aã]o nos responsabilizamos|asseguramos a autenticidade)/i.test(line)) { ignoreFooter = true; continue; }
    if (ignoreFooter) { if (!/^(transfer[êe]ncia|pagamento|pix|rendimento)/i.test(line)) continue; ignoreFooter = false; }
    if (!date || !line || /^(total de |saldo |valores em|movimenta[çc][õo]es|\d+ de \d+$)/i.test(line)) continue;
    if (/^tiago filipe|^.*CPF.*Ag[êe]ncia.*Conta|^a \d{2} de /i.test(line)) continue;
    const inlineAmount = line.match(/^(.*?)([-+]?\s?\d{1,3}(?:\.\d{3})*,\d{2})$/);
    if (inlineAmount && /(?:transfer[êe]ncia|pagamento|pix|rendimento)/i.test(inlineAmount[1])) { description.push(inlineAmount[1]); flush(inlineAmount[2]); continue; }
    if (/^[-+]?\s?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(line)) { flush(line); continue; }
    description.push(line);
  }
  return unique(transactions);
}

function parseMercadoPago(text: string): StatementTransaction[] {
  const transactions: StatementTransaction[] = [];
  const cleaned = text.replace(/\bDe\s+\d{2}-\d{2}-\d{4}\s+al\s+\d{2}-\d{2}-\d{4}Periodo:/i, '');
  const pattern = /(\d{2})-(\d{2})-(\d{4})\s+([\s\S]*?)\s+\d{10,14}\s*R\$\s*(-?[\d.]+,\d{2})\s*R\$\s*[-\d.]+,\d{2}/g;
  for (const match of cleaned.matchAll(pattern)) {
    const amount = normalizeAmount(match[5]);
    const description = match[4].replace(/\bData\s*Descri[çc][ãa]o\s*ID da opera[çc][ãa]o\s*Valor\s*Saldo\b/gi, '').replace(/\s+/g, ' ').trim();
    if (!description || !Number.isFinite(amount) || amount === 0) continue;
    transactions.push({ date: `${match[3]}-${match[2]}-${match[1]}`, description: description.slice(0, 200), amount: Math.abs(amount), kind: amount < 0 ? 'expense' : 'income', provider: 'mercado_pago' });
  }
  return unique(transactions);
}

function parseGeneric(text: string): StatementTransaction[] {
  const transactions: StatementTransaction[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const date = line.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const amounts = [...line.matchAll(/-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}/g)];
    const lastAmount = amounts[amounts.length - 1];
    const amountText = lastAmount?.[0];
    if (!date || !amountText) continue;
    const amount = normalizeAmount(amountText);
    const description = line.slice((date.index ?? 0) + date[0].length, lastAmount?.index).trim();
    if (!description || !Number.isFinite(amount) || amount === 0 || /^(saldo|total|limite)/i.test(description)) continue;
    transactions.push({ date: `${date[3]}-${date[2]}-${date[1]}`, description: description.slice(0, 200), amount: Math.abs(amount), kind: amount < 0 || /\b(d[eé]bito|pagamento|compra|sa[ií]da)\b/i.test(line) ? 'expense' : 'income', provider: 'generic' });
  }
  return unique(transactions);
}

export function parseStatementPdf(text: string): ParsedStatement {
  const mercadoPago = parseMercadoPago(text);
  if (mercadoPago.length) return { provider: 'mercado_pago', transactions: mercadoPago };
  const nubank = parseNubank(text);
  if (nubank.length) return { provider: 'nubank', transactions: nubank };
  return { provider: 'generic', transactions: parseGeneric(text) };
}

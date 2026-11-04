/** Compras por centro de custo: leitura do relatório e rateio entre serviços. */
export type CcItem = { code: string; desc: string; qty: number; amount: number; date?: string | null };
export type CcLine = { cc: string; name: string; amount: number; items: CcItem[] };
export type PClient = { id: string; prefix: string | null };
export type PWork = { id: string; client_id: string; suffix: string | null };
export type Direction = { client_id?: string | null; work_id?: string | null };
export type Allocation = { status: "launched" | "pending"; reason: string | null; parts: { work_id: string; amount: number }[] };

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);

/** Data de uma célula identificada pelo cabeçalho, nunca a data de emissão do relatório. */
function rowDate(c: unknown): string | null {
    if (c instanceof Date && !isNaN(c.getTime())) return c.toISOString().slice(0, 10);
    if (typeof c === "number" && Number.isFinite(c)) return new Date(Date.UTC(1899, 11, 30) + c * 86400000).toISOString().slice(0, 10);
    if (typeof c === "string") {
      const m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
    }
  return null;
}

/** Categorias exibidas no filtro de itens de Compras. */
export const PURCHASE_CATEGORIES = [
  { key: "mo", label: "Mão de obra" },
  { key: "materiais", label: "Materiais" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "transporte", label: "Transporte" },
  { key: "andaimes", label: "Andaimes" },
] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number]["key"];

/** Classificação do item pela descrição/código. */
export function purchaseCategory(code: string, desc: string): PurchaseCategory {
  const d = `${desc}`.toLowerCase();
  if (/^vc/i.test(code) || /ped[aá]gio|combust|gasolina|diesel|etanol|pneu|[oó]leo motor|ve[ií]culo|automot|mec[aâ]nica|funilaria|frete|uber|táxi|taxi|passagem|transporte/.test(d)) return "transporte";
  if (/andaime|escora|braçadeira|bracadeira|tubo andaime|sapata|rodizio andaime/.test(d)) return "andaimes";
  if (/m[aã]o de obra|servi[cç]o de|empreitada|mo terceir|prestação|prestacao|diária|diaria/.test(d)) return "mo";
  if (/furadeira|parafusadeira|esmerilhadeira|serra|broca|disco de corte|chave |alicate|martelo|trena|n[ií]vel|rolo|trincha|pincel|esp[aá]tula|lixadeira|ferramenta|marreta|talhadeira|extensão|extensao|escada/.test(d)) return "ferramentas";
  return "materiais";
}

/** Relatório "Compras de Produtos por Centro de Custo" (ABCOM003). */
export function parsePurchaseReport(rows: unknown[][]): CcLine[] {
  const normalize = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  type Columns = { code: number; desc: number; qty: number; total: number; date?: number };
  let columns: Columns | null = null;
  let anchors: { qty: number; total: number } | null = null;
  const abcom = rows.some((r) => r.some((c) => normalize(c) === "abcom003"));
  const error = (detail: string) => new Error(`ABCOM003: ${detail}. Importação interrompida para evitar valores incorretos.`);
  const numeric = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?(?:R\$\s*)?\d[\d.,]*$/.test(v.trim()));
  const value = (v: unknown) => num(typeof v === "string" ? v.replace(/R\$\s*/g, "").trim() : v);
  const map = new Map<string, CcLine>();
  let cur: CcLine | null = null;
  for (const [rowIndex, r] of rows.entries()) {
    const cells = r.map((c) => (typeof c === "string" ? c.trim() : c));
    const labels = cells.map(normalize);
    const qty = labels.findIndex((c) => /^(quantidade|qtde|qtd|quant)$/.test(c));
    const total = labels.findIndex((c) => /^(valortotal|vlrtotal|vrtotal|total|totalitem|valortotalitem)$/.test(c));
    if (qty >= 0 && total >= 0) {
      const code = labels.findIndex((c) => /^(codigo|cod|codproduto|codigoproduto|codigodoproduto|produto)$/.test(c));
      const desc = labels.findIndex((c) => /^(descricao|descricaoproduto|descricaodoproduto|nomeproduto)$/.test(c));
      const date = labels.findIndex((c) => /^(data|datacompra|dataemissao|dtcompra|dtemissao)$/.test(c));
      anchors = { qty, total };
      columns = code >= 0 && desc >= 0 ? { code, desc, qty, total, ...(date >= 0 ? { date } : {}) } : null;
      if (!columns && !abcom) throw error("cabeçalho incompleto: faltam Código/Produto e Descrição");
      continue;
    }
    const ccIdx = labels.findIndex((c) => c === "centrocusto" || c === "centrodecusto");
    if (ccIdx >= 0) {
      const rest = cells.slice(ccIdx + 1).filter((c) => c !== "" && c != null);
      const cc = String(rest[0] ?? "").replace(/\D/g, "");
      if (!cc) { cur = null; continue; }
      cur = map.get(cc) ?? { cc, name: String(rest[1] ?? "").trim(), amount: 0, items: [] };
      map.set(cc, cur);
      continue;
    }
    if (!cur) continue;
    if (labels.some((c) => c === "totalcc" || c === "totalcentrocusto")) {
      const subtotal = cells.filter(numeric);
      if (subtotal.length !== 1 || Math.abs(cur.amount - value(subtotal[0])) > 0.011) throw error(`total do CC ${cur.cc} não confere na linha ${rowIndex + 1}`);
      continue;
    }
    // O exportador ABCOM003 omite Código/Descrição e mescla cabeçalhos em
    // posições diferentes dos dados. Resolve o layout pelos dois rótulos e
    // pelas quatro células do item, sem assumir números fixos de coluna.
    if (!columns && anchors && abcom) {
      const occupied = cells.map((v, i) => ({ v, i })).filter(({ v }) => v !== "" && v != null);
      if (occupied.length !== 4 || !/^[A-Z0-9]{3,}$/i.test(String(occupied[0]?.v)) || typeof occupied[1]?.v !== "string" || !numeric(occupied[2]?.v) || !numeric(occupied[3]?.v)) continue;
      const [code, desc, q, t] = occupied;
      if (!code || !desc || !q || !t) continue;
      if (Math.abs(q.i - anchors.qty) > 2 || Math.abs(t.i - anchors.total) > 2 || q.i >= t.i) throw error(`colunas ambíguas na linha ${rowIndex + 1}`);
      columns = { code: code.i, desc: desc.i, qty: q.i, total: t.i };
    }
    if (!columns) {
      if (cells.some(numeric) && cells.some((c) => typeof c === "string" && /^[A-Z]+\d{3,}$/i.test(c))) throw error("cabeçalho Quantidade e Valor Total não encontrado");
      continue;
    }
    const code = String(cells[columns.code] ?? "");
    if (!/^[A-Z0-9]{3,}$/i.test(code)) continue;
    if (!numeric(cells[columns.qty]) || !numeric(cells[columns.total]) || !String(cells[columns.desc] ?? "").trim()) throw error(`item ${code} inválido na linha ${rowIndex + 1}`);
    const it = { code, desc: String(cells[columns.desc]).trim(), qty: value(cells[columns.qty]), amount: value(cells[columns.total]), date: columns.date == null ? null : rowDate(cells[columns.date]) };
    cur.items.push(it);
    cur.amount = Math.round((cur.amount + it.amount) * 100) / 100;
  }
  if (!anchors) throw error("cabeçalho Quantidade e Valor Total não encontrado");
  return [...map.values()].filter((l) => l.amount !== 0);
}

/** Mês de referência pelo fim do período do nome do arquivo (ex.: 01.10.2026-22.10.2026.xls). */
export function purchaseFileMonth(name: string): { ym: string; end: string } | null {
  const m = name.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return { ym: `${m[6]}-${m[5]}`, end: `${m[6]}-${m[5]}-${m[4]}` };
}

function split(total: number, ids: string[], hours: Map<string, number>) {
  const w = ids.map((id) => hours.get(id) ?? 0);
  const sum = w.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? w : ids.map(() => 1);
  const tw = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(total * 100);
  let used = 0;
  return ids.map((id, i) => {
    const c = i === ids.length - 1 ? cents - used : Math.round((cents * weights[i]!) / tw);
    used += c;
    return { work_id: id, amount: c / 100 };
  });
}

/**
 * 1) Direcionamento manual para um serviço: valor total nele.
 * 2) Prefixo + sufixo cadastrados: rateio por horas entre os serviços com esse sufixo.
 * 3) Sem sufixo correspondente: serviços do cliente com movimentação no mês — 1 recebe o total, vários rateiam por horas.
 * 4) Sem cliente ou sem movimentação: pendente para direcionamento.
 */
export function allocatePurchase(cc: string, amount: number, clients: PClient[], works: PWork[], hours: Map<string, number>, dir?: Direction): Allocation {
  if (dir?.work_id) return { status: "launched", reason: null, parts: [{ work_id: dir.work_id, amount }] };
  const client = dir?.client_id ? clients.find((c) => c.id === dir.client_id) : clients.find((c) => c.prefix && c.prefix === cc.slice(0, 4));
  if (!client) return { status: "pending", reason: "Nenhum cliente com este prefixo", parts: [] };
  const own = works.filter((w) => w.client_id === client.id);
  const suffix = cc.length > 4 ? cc.slice(4) : null;
  if (suffix && !dir?.client_id) {
    const match = own.filter((w) => w.suffix === suffix).map((w) => w.id);
    if (match.length) return { status: "launched", reason: null, parts: split(amount, match, hours) };
  }
  const moving = own.filter((w) => (hours.get(w.id) ?? 0) > 0).map((w) => w.id);
  if (!moving.length) return { status: "pending", reason: "Nenhum serviço do cliente com movimentação no mês", parts: [] };
  return { status: "launched", reason: null, parts: split(amount, moving, hours) };
}

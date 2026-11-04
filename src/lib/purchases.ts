/** Compras por centro de custo: leitura do relatório e rateio entre serviços. */
export type CcItem = { code: string; desc: string; qty: number; amount: number; date?: string | null };
export type CcLine = { cc: string; name: string; amount: number; items: CcItem[] };
export type PClient = { id: string; prefix: string | null };
export type PWork = { id: string; client_id: string; suffix: string | null };
export type Direction = { client_id?: string | null; work_id?: string | null };
export type Allocation = { status: "launched" | "pending"; reason: string | null; parts: { work_id: string; amount: number }[] };

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);

/** Data da linha do relatório (serial do Excel, Date ou dd/mm/aaaa) → aaaa-mm-dd. */
function rowDate(cells: unknown[]): string | null {
  for (const c of cells) {
    if (c instanceof Date && !isNaN(c.getTime())) return c.toISOString().slice(0, 10);
    if (typeof c === "string") {
      const m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    }
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
  const map = new Map<string, CcLine>();
  let cur: CcLine | null = null;
  for (const r of rows) {
    const cells = r.map((c) => (typeof c === "string" ? c.trim() : c));
    const ccIdx = cells.findIndex((c) => c === "Centro Custo:");
    if (ccIdx >= 0) {
      const rest = cells.slice(ccIdx + 1).filter((c) => c !== "" && c != null);
      const cc = String(rest[0] ?? "").replace(/\D/g, "");
      if (!cc) { cur = null; continue; }
      cur = map.get(cc) ?? { cc, name: String(rest[1] ?? "").trim(), amount: 0, items: [] };
      map.set(cc, cur);
      continue;
    }
    if (!cur) continue;
    const code = String(cells[2] ?? "");
    if (code && /^[A-Z0-9]{3,}$/i.test(code) && typeof cells[12] === "number") {
      const it = { code, desc: String(cells[3] ?? "").trim(), qty: num(cells[8]), amount: num(cells[12]), date: rowDate(cells) };
      cur.items.push(it);
      cur.amount = Math.round((cur.amount + it.amount) * 100) / 100;
    }
  }
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

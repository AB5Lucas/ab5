/**
 * Pedidos › MARS MM: leitura da planilha "Faturamento MARS <ano>.xlsx" (aba "<ano> - <Mês>"), regras puras.
 * Em cima fica GESTÃO DE FATURAMENTO e embaixo GESTÃO DE ORDENS DE SERVIÇOS. Cada item vira um serviço próprio
 * (nunca mensal, BDI e andamento 100%); o CONTRATO SANITATION (medição mensal) não cria serviço: o valor do contrato
 * é dividido em novas linhas de pedido dos serviços do contrato, na proporção da medição anterior.
 */
export const MARS_CLIENT = "MARS MM";
export const MARS_MANAGER = "Felipe Hideki Oki";
/** Pedido do contrato recorrente: os serviços que têm esse pedido recebem as linhas de cada medição. */
export const MARS_CONTRACT_ORDER = "4500777910";
export const MARS_CONTRACT_VALUE = 188131.05;

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const marsFile = (ym: string) => `Serviços/SERVIÇOS EXTERNOS/MARS MM/Faturamento MARS ${ym.slice(0, 4)}.xlsx`;
export const marsSheetName = (ym: string) => `${ym.slice(0, 4)} - ${MONTHS[Number(ym.slice(5, 7)) - 1]}`;
export const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export type MarsTable = "faturamento" | "ordens";
export type MarsRow = {
  table: MarsTable; key: string; quote: string; order: string | null; requester: string; category: string;
  description: string; value: number; status: string; notes: string; contract: boolean; cancelled: boolean;
};

export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const toNum = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);
/** Nº do pedido só quando é número (Medição, SEM, "Enviar dia 15/10" = sem pedido). */
export const orderOf = (v: unknown) => { const s = String(v ?? "").replace(/\s/g, ""); return /^\d{6,}$/.test(s) ? s : null; };
const isQuote = (s: string) => /^\d{2}\/\d+/.test(s);

export function rowKey(r: Pick<MarsRow, "quote" | "order" | "description">) {
  if (isQuote(r.quote)) return `Q:${r.quote}`;
  return r.order ? `P:${r.order}:${norm(r.description)}` : `D:${norm(r.description)}`;
}

/** Lê as duas tabelas da aba do mês pelos títulos e cabeçalhos (colunas achadas pelo nome). */
export function parseMarsSheet(rows: unknown[][]): MarsRow[] {
  const out: MarsRow[] = [];
  let table: MarsTable | null = null;
  let col: Record<string, number> | null = null;
  for (const raw of rows) {
    const cells = (raw ?? []).map(norm);
    const first = cells.find(Boolean) ?? "";
    if (first.startsWith("GESTAO DE FATURAMENTO")) { table = "faturamento"; col = null; continue; }
    if (first.startsWith("GESTAO DE ORDENS")) { table = "ordens"; col = null; continue; }
    if (!table) continue;
    if (!col) {
      if (cells.some((c) => c.includes("PEDIDO")) && cells.some((c) => c.startsWith("DESCRI"))) {
        const at = (p: (c: string) => boolean) => cells.findIndex(p);
        col = {
          quote: at((c) => c.includes("ORC")), order: at((c) => c.includes("PEDIDO")), requester: at((c) => c === "CLIENTE"),
          category: at((c) => c === "CATEGORIA"), description: at((c) => c.startsWith("DESCRI")), value: at((c) => c === "VALOR"),
          status: at((c) => c === "STATUS"), notes: at((c) => c.startsWith("OBSERVA")),
        };
      }
      continue;
    }
    const get = (k: string) => (col![k]! >= 0 ? raw[col![k]!] : "");
    const description = String(get("description") ?? "").trim();
    const quote = String(get("quote") ?? "").trim();
    if (!description && !quote) { table = null; col = null; continue; } // linha do total: fim da tabela
    const value = Math.round(toNum(get("value")) * 100) / 100;
    const order = orderOf(get("order"));
    const status = String(get("status") ?? "").trim();
    const notes = String(get("notes") ?? "").trim();
    const r = {
      table, quote, order, description, value, status, notes,
      requester: String(get("requester") ?? "").trim(), category: String(get("category") ?? "").trim(),
      contract: /CONTRATO SANITATION/.test(norm(description)),
      cancelled: /CANCELAD/.test(norm(`${status} ${notes}`)),
    };
    out.push({ ...r, key: rowKey(r) });
  }
  return out;
}

export type MarsOrder = { number?: string | null; value?: number | string | null; date?: string | null };
export type MarsWork = { id: string; name: string; quote_number: string | null; orders: MarsOrder[] | null; active?: boolean | null };

/** Serviço que já tem o item: mesmo Nº Orç., ou o pedido já lançado em algum serviço; medição Inbound vai ao serviço Inbound. */
export function matchWork(r: MarsRow, works: MarsWork[]): MarsWork | undefined {
  if (isQuote(r.quote)) { const w = works.find((x) => (x.quote_number ?? "").trim() === r.quote); if (w) return w; }
  if (r.order) { const w = works.find((x) => (x.orders ?? []).some((o) => String(o.number ?? "") === r.order)); if (w) return w; }
  if (/INBOUND/.test(norm(r.description))) return works.find((x) => /INBOU/.test(norm(x.name)));
  return undefined;
}

/** Itens a tratar: só a tabela de ordens (e, na 1ª leitura, também a de faturamento); um por chave; sem cancelados e sem valor. */
export function rowsToSync(rows: MarsRow[], firstRun: boolean): MarsRow[] {
  const seen = new Set<string>();
  // A tabela de ordens vale mais (valor do pedido; no faturamento o mesmo orçamento pode vir em parcelas).
  const sorted = [...rows.filter((r) => r.table === "ordens"), ...rows.filter((r) => r.table === "faturamento")];
  return sorted.filter((r) => {
    if (r.contract || r.cancelled || !(r.value > 0)) return false;
    if (r.table === "faturamento" && !firstRun) return false;
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Medição do contrato: base = linhas do pedido do contrato do último mês antes de `ym` em cada serviço;
 * o valor é dividido na mesma proporção e a diferença dos centavos vai para a maior linha (soma exata).
 */
export function splitContract(works: MarsWork[], ym: string, total: number, order = MARS_CONTRACT_ORDER): { id: string; name: string; value: number }[] {
  const lines = works.flatMap((w) => (w.orders ?? []).filter((o) => String(o.number ?? "") === order && o.date && String(o.date).slice(0, 7) < ym)
    .map((o) => ({ w, month: String(o.date).slice(0, 7), value: Number(o.value ?? 0) })));
  if (!lines.length) return [];
  const last = lines.reduce((m, l) => (l.month > m ? l.month : m), "");
  const base = new Map<string, { id: string; name: string; value: number }>();
  for (const l of lines.filter((x) => x.month === last)) {
    const cur = base.get(l.w.id) ?? { id: l.w.id, name: l.w.name, value: 0 };
    cur.value += l.value;
    base.set(l.w.id, cur);
  }
  const list = [...base.values()].filter((b) => b.value > 0);
  const sum = list.reduce((a, b) => a + b.value, 0);
  if (!sum) return [];
  const out = list.map((b) => ({ ...b, value: money((total * b.value) / sum) }));
  const diff = money(total - out.reduce((a, b) => a + b.value, 0));
  if (diff) { const big = out.reduce((m, b) => (b.value > m.value ? b : m)); big.value = money(big.value + diff); }
  return out;
}

/** Serviços do contrato: os que têm o pedido do contrato (4500777910, o da 1ª medição registrada). */
const contractWorks = (works: MarsWork[], order: string) => works.filter((w) => (w.orders ?? []).some((o) => String(o.number ?? "") === order));

/** O contrato já foi medido no mês: algum serviço do contrato tem linha com data no mês e o mesmo valor-base de pedido de medição. */
export const contractMeasured = (works: MarsWork[], ym: string, order = MARS_CONTRACT_ORDER) =>
  contractWorks(works, order).some((w) => (w.orders ?? []).some((o) => String(o.number ?? "") === order && String(o.date ?? "").slice(0, 7) === ym));

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
/** Pedidos com "andaime" na descrição não viram serviço: entram como linhas do serviço Contrato Andaimes. */
export const MARS_SCAFFOLD_WORK = "Contrato Andaimes";

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
  /** Sufixo do CC do serviço (coluna C da planilha); vazio = sem sufixo informado. */
  suffix: string;
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

/**
 * Coluna do sufixo do CC: título com "SUFIXO"/"SULFIXO"/"CC"/"CENTRO DE CUSTO"; sem título assim, a coluna C
 * quando ela não é nenhuma das outras (Nº Orç., pedido, cliente…).
 */
/** Sufixo do CC com 3 dígitos (regra do cadastro de serviços): "12" → "012"; CC inteiro ("2004221") → os 3 últimos;
 * outra coisa (texto, número longo) → vazio, para não gravar valor inválido. */
export function ccSuffix(raw: unknown): string {
  const d = String(raw ?? "").trim().replace(/\.0+$/, "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 3) return d.padStart(3, "0");
  if (d.length <= 7) return d.slice(-3);
  return "";
}

export function suffixCol(cells: string[]): number {
  const byName = cells.findIndex((c) => /SU?L?FIXO|^CC$|CENTRO DE CUSTO/.test(c));
  if (byName >= 0) return byName;
  const c = cells[2] ?? "";
  return !c || !/ORC|PEDIDO|CLIENTE|CATEGORIA|DESCRI|VALOR|STATUS|OBSERVA|NF|DATA|RESPONS|PRAZO/.test(c) ? 2 : -1;
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
          suffix: suffixCol(cells),
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
    const suffix = ccSuffix(get("suffix"));
    const r = {
      table, quote, order, description, value, status, notes, suffix,
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

/**
 * Itens a tratar: a tabela de ordens e, da de faturamento, só o que não está nas ordens (mesmo Nº Orç. ou pedido):
 * pedido faturado que nunca passou pela tabela de ordens também precisa existir. Na 1ª leitura, o faturamento inteiro.
 * Um por chave; sem cancelados e sem valor.
 */
export function rowsToSync(rows: MarsRow[], firstRun: boolean): MarsRow[] {
  const seen = new Set<string>();
  // A tabela de ordens vale mais (valor do pedido; no faturamento o mesmo orçamento pode vir em parcelas).
  // Item das ordens ainda sem pedido: o pedido que já aparece no faturamento (mesmo Nº Orç.) vale para ele.
  const billedOrder = new Map(rows.filter((r) => r.table === "faturamento" && isQuote(r.quote) && r.order).map((r) => [r.quote, r.order]));
  const ordens = rows.filter((r) => r.table === "ordens").map((r) => (!r.order && isQuote(r.quote) && billedOrder.has(r.quote) ? { ...r, order: billedOrder.get(r.quote)! } : r));
  const quotes = new Set(ordens.map((r) => r.quote).filter((q) => isQuote(q)));
  const orders = new Set(ordens.map((r) => r.order).filter(Boolean));
  const sorted = [...ordens, ...rows.filter((r) => r.table === "faturamento")];
  return sorted.filter((r) => {
    if (r.contract || r.cancelled || !(r.value > 0)) return false;
    if (r.table === "faturamento" && !firstRun && ((isQuote(r.quote) && quotes.has(r.quote)) || (r.order && orders.has(r.order)) || (!r.order && !isQuote(r.quote)))) return false;
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

/** Item de andaime pela Categoria (coluna B; sem categoria, pela descrição): vai para o Contrato Andaimes em vez de criar serviço. */
export const isScaffoldRow = (r: Pick<MarsRow, "description"> & { category?: string }) =>
  (r.category ?? "").trim() ? /ANDAIME/.test(norm(r.category)) : /ANDAIME/.test(norm(r.description));
export const findScaffoldWork = (works: MarsWork[]) => works.find((w) => norm(w.name) === norm(MARS_SCAFFOLD_WORK));
/** Item de caldeiraria pela Categoria (CALDEIRARIA/MECANICA…): vai para a Base Calderaria em vez de criar serviço. */
export const isBoilerRow = (r: { category?: string }) => /CALDE?I?RARIA|CALDERARIA/.test(norm(r.category ?? ""));
export const findBoilerWork = (works: MarsWork[]) => works.find((w) => /^BASE CALDE?I?RARIA/.test(norm(w.name)));

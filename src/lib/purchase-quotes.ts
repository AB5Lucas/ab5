/**
 * Recomendação de compra (Comprador › Recomendação e Aprovação): regras puras, sem acesso ao banco.
 * Cada item da cotação ligado a um item da SC vira uma opção; o preço é levado para a unidade da SC pelo
 * fator de conversão do TOTVS (Multiplicador: 1 un. da SC = fator un. da cotação; Divisor: 1 un. da cotação =
 * fator un. da SC — ex.: SC 5 KG, cotação 1 RL de 5 kg → fator 5, Divisor).
 * Ranking pelos critérios marcados (valor menor, prazo de entrega menor, prazo de pagamento MAIOR), cada um
 * normalizado de 0 a 1 entre as opções do item e somados; empate = menor valor.
 */
/** "frete" = Frete grátis (toggle à parte): soma 1 ponto às opções de cotação com frete R$ 0. */
export type Criterion = "valor" | "prazo" | "pagamento" | "frete";
export const CRITERIA: { value: Criterion; label: string; hint: string }[] = [
  { value: "valor", label: "Valor", hint: "menor valor total" },
  { value: "prazo", label: "Prazo de entrega", hint: "entrega mais rápida" },
  { value: "pagamento", label: "Condição de pagamento", hint: "maior prazo para pagar" },
];

export type QuoteLite = {
  id: string; supplier: string | null; file_path: string; file_name: string | null; source: string;
  payment_terms: string | null; payment_days: number | null; delivery_days: number | null; freight: number | null; total: number | null;
  /** Faturamento mínimo do fornecedor (R$); null = não lido nem digitado, 0 = sem mínimo. */
  min_order?: number | null;
  read_status: string; read_error: string | null; quote_number: string | null; matched: boolean;
};
export type QuoteItemLite = {
  id: string; quote_id: string; line_no: number; description: string; quantity: number | null; unit: string | null;
  unit_price: number | null; total: number | null; request_item_id: string | null; conv_factor: number; conv_type: string; discarded: boolean;
};
export type ScItemLite = {
  id: string; item_no: number; quantity: number; unit: string; description: string; budget: number | null; rec_quote_item_id: string | null;
};

export type Option = {
  quoteItem: QuoteItemLite; quote: QuoteLite;
  /** Preço por unidade da SC. */
  unitPrice: number;
  /** Total para a quantidade da SC. */
  total: number;
  deliveryDays: number | null; paymentDays: number | null; score: number;
};

const n = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Preço unitário da cotação (do campo, senão total ÷ quantidade). */
export function quoteUnitPrice(qi: Pick<QuoteItemLite, "unit_price" | "total" | "quantity">): number | null {
  const up = n(qi.unit_price);
  if (up != null && up > 0) return up;
  const t = n(qi.total), q = n(qi.quantity);
  return t != null && q != null && q > 0 ? t / q : null;
}

/** Preço por unidade da SC conforme o fator de conversão. */
export function priceInScUnit(unitPrice: number, factor: number, type: string): number {
  const f = factor > 0 ? factor : 1;
  return type === "D" ? unitPrice / f : unitPrice * f;
}

/** Quantidade equivalente na unidade da cotação. */
export function quoteQtyFor(scQty: number, factor: number, type: string): number {
  const f = factor > 0 ? factor : 1;
  return type === "D" ? scQty / f : scQty * f;
}

const normUnit = (u: string | null | undefined) => (u ?? "").trim().toUpperCase().replace(/\.$/, "").replace(/^UND?$|^UNID(ADE)?S?$/, "UN").replace(/^P[CÇ]S?$|^PE[CÇ]AS?$/, "PC");

/**
 * Sugestão do fator (como o treinamento do TOTVS): mesma unidade e quantidade → 1 Multiplicador;
 * quantidades diferentes → a razão entre elas (SC maior = Divisor; cotação maior = Multiplicador).
 */
export function suggestConversion(scQty: number, scUnit: string, qQty: number | null, qUnit: string | null): { factor: number; type: "M" | "D" } {
  if (!qQty || qQty <= 0 || !scQty || scQty <= 0) return { factor: 1, type: "M" };
  if (normUnit(scUnit) === normUnit(qUnit) || Math.abs(scQty - qQty) < 1e-9) return { factor: 1, type: "M" };
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return scQty > qQty ? { factor: round(scQty / qQty), type: "D" } : { factor: round(qQty / scQty), type: "M" };
}

/** Opções de um item da SC (itens da cotação ligados e não descartados), já ordenadas pelos critérios. */
export function itemOptions(item: ScItemLite, quotes: QuoteLite[], qItems: QuoteItemLite[], criteria: Criterion[]): Option[] {
  const qById = new Map(quotes.map((q) => [q.id, q]));
  const raw: Option[] = [];
  for (const qi of qItems) {
    if (qi.request_item_id !== item.id || qi.discarded) continue;
    const quote = qById.get(qi.quote_id);
    const up = quoteUnitPrice(qi);
    if (!quote || up == null) continue;
    const unitPrice = priceInScUnit(up, Number(qi.conv_factor), qi.conv_type);
    raw.push({ quoteItem: qi, quote, unitPrice, total: unitPrice * Number(item.quantity || 0), deliveryDays: quote.delivery_days, paymentDays: quote.payment_days, score: 0 });
  }
  return rankOptions(raw, criteria);
}

export function rankOptions(opts: Option[], criteria: Criterion[]): Option[] {
  const crit = criteria.some((c) => c !== "frete") ? criteria : (["valor", ...criteria] as Criterion[]);
  const minTotal = Math.min(...opts.map((o) => o.total).filter((x) => x > 0), Infinity);
  const dels = opts.map((o) => o.deliveryDays).filter((x): x is number => x != null);
  const pays = opts.map((o) => o.paymentDays).filter((x): x is number => x != null);
  const minDel = dels.length ? Math.min(...dels) : null;
  const maxPay = pays.length ? Math.max(...pays) : null;
  for (const o of opts) {
    let s = 0;
    if (crit.includes("valor")) s += o.total > 0 && Number.isFinite(minTotal) ? minTotal / o.total : 0;
    if (crit.includes("prazo")) s += o.deliveryDays != null && minDel != null ? (minDel + 1) / (o.deliveryDays + 1) : 0;
    if (crit.includes("pagamento")) s += o.paymentDays != null && maxPay != null ? (o.paymentDays + 1) / (maxPay + 1) : 0;
    if (crit.includes("frete")) s += o.quote.freight != null && Number(o.quote.freight) === 0 ? 1 : 0;
    o.score = s;
  }
  return [...opts].sort((a, b) => b.score - a.score || a.total - b.total || (a.deliveryDays ?? 1e9) - (b.deliveryDays ?? 1e9));
}

/** Escolha do item: a marcada pelo comprador (se ainda é opção), senão a melhor. */
export function chosenOption(item: ScItemLite, options: Option[]): { option: Option | null; index: number; manual: boolean } {
  const i = item.rec_quote_item_id ? options.findIndex((o) => o.quoteItem.id === item.rec_quote_item_id) : -1;
  if (i >= 0) return { option: options[i]!, index: i, manual: i !== 0 };
  return { option: options[0] ?? null, index: options.length ? 0 : -1, manual: false };
}

/** Escolha anterior (volta uma posição; da 1ª vai para a última). */
export function prevOption(options: Option[], index: number): Option | null {
  if (options.length < 2) return null;
  return options[(index - 1 + options.length) % options.length]!;
}

/** Próxima melhor escolha (dá a volta para a primeira). */
export function nextOption(options: Option[], index: number): Option | null {
  if (options.length < 2) return null;
  return options[(index + 1) % options.length]!;
}

export type RecRow = { item: ScItemLite; options: Option[]; chosen: Option | null; index: number; manual: boolean };
export function recommendation(items: ScItemLite[], quotes: QuoteLite[], qItems: QuoteItemLite[], criteria: Criterion[]) {
  const rows: RecRow[] = [...items].sort((a, b) => a.item_no - b.item_no).map((item) => {
    const options = itemOptions(item, quotes, qItems, criteria);
    const c = chosenOption(item, options);
    return { item, options, chosen: c.option, index: c.index, manual: c.manual };
  });
  const total = rows.reduce((s, r) => s + (r.chosen?.total ?? 0), 0);
  return { rows, total, covered: rows.filter((r) => r.chosen).length };
}

/** Verba da SC: a total, senão a soma dos itens (null = sem verba). */
export function scBudget(totalBudget: number | null | undefined, items: { budget: number | null }[]): number | null {
  const t = Number(totalBudget ?? 0);
  if (t > 0) return t;
  const s = items.reduce((a, i) => a + Number(i.budget ?? 0), 0);
  return s > 0 ? s : null;
}

/** Indicador contra a verba: acima = vermelho, igual = laranja, abaixo = verde. */
export function budgetSignal(total: number | null | undefined, budget: number | null | undefined): { tone: "acima" | "igual" | "abaixo" | "sem"; cls: string; label: string } {
  if (budget == null || !(budget > 0) || total == null) return { tone: "sem", cls: "bg-muted-foreground/40", label: "Sem verba" };
  const diff = Math.round((total - budget) * 100);
  if (diff > 0) return { tone: "acima", cls: "bg-red-500", label: "Acima da verba" };
  if (diff === 0) return { tone: "igual", cls: "bg-orange-500", label: "Igual à verba" };
  return { tone: "abaixo", cls: "bg-emerald-500", label: "Abaixo da verba" };
}

/** Regra da aprovação (igual a purchase_fa_rule_of no banco). */
export type FaRule = "verba" | "dupla" | "diretor";
/** Resultado do envio ao comprador pelo estado dos itens em aprovação (null = ainda há pendentes sem decisão geral). */
export type FaOutcome = "aprovada" | "parcial" | "recusada";
export function faOutcome(approved: number, rejected: number, pending: number): FaOutcome | null {
  if (pending > 0) return null;
  if (approved > 0 && rejected > 0) return "parcial";
  if (approved > 0) return "aprovada";
  if (rejected > 0) return "recusada";
  return null;
}

export function approvalRule(total: number, budget: number | null, due: string | null, today: string, overItems = false, programmed = false): FaRule {
  if (programmed) return "verba";
  if (!overItems && budget != null && total <= budget + 1e-9) return "verba";
  if (due) {
    const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (days <= 2) return "dupla";
  }
  return "diretor";
}
/** Algum item escolhido passa da própria verba (igual a purchase_fa_items_over no banco). */
export function itemsOverBudget(rows: RecRow[]): boolean {
  return rows.some((r) => r.chosen != null && Number(r.item.budget ?? 0) > 0 && Math.round(r.chosen.total * 100) > Math.round(Number(r.item.budget) * 100));
}
export const RULE_LABEL: Record<FaRule, string> = {
  verba: "Dentro da verba (total e todos os itens) ou compra programada: aprova o nível Operacional (depois a ciência do Executivo)",
  dupla: "Acima da verba (total ou algum item) com prazo em até 2 dias: aprovação dupla (Operacional + Gestor da obra; depois a ciência do Executivo)",
  diretor: "Acima da verba (total ou algum item) e prazo maior que 2 dias: só o nível Executivo aprova",
};

/** Semelhança simples de descrições (palavras em comum), para sugerir a ligação quando a IA não indicou. */
const words = (s: string) => new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let k = 0;
  for (const w of A) if (B.has(w)) k++;
  return k / Math.min(A.size, B.size);
}
export function bestScItem(desc: string, items: { id: string; description: string }[]): string | null {
  let best: string | null = null, bs = 0.34;
  for (const it of items) { const s = similarity(desc, it.description); if (s > bs) { bs = s; best = it.id; } }
  return best;
}

/** Total da compra por cotação = soma do valor total dos itens escolhidos nela (Recomendação). */
export function purchaseTotalsByQuote(rows: { chosen?: { quote: { id: string }; total: number } | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.chosen) m.set(r.chosen.quote.id, (m.get(r.chosen.quote.id) ?? 0) + r.chosen.total);
  return m;
}
/** Bolinha do fornecedor (só indicativo): verde = compra ≥ faturamento mínimo, vermelho = abaixo; sem mínimo/sem compra = nada. */
export function minOrderState(purchase: number, minOrder: number | null | undefined): "ok" | "below" | null {
  if (minOrder == null || purchase <= 0) return null;
  return purchase + 0.005 >= Number(minOrder) ? "ok" : "below";
}

/** Leitura da IA → campos da cotação (aceita o JSON dentro de ```json```). */
export type QuoteReading = {
  supplier: string | null; supplier_doc: string | null; quote_number: string | null; quote_date: string | null;
  payment_terms: string | null; payment_days: number | null; delivery_days: number | null; freight: number | null; total: number | null;
  min_order: number | null;
  items: { description: string; quantity: number | null; unit: string | null; unit_price: number | null; total: number | null; sc_item: number | null }[];
};
const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = String(v).replace(/[^\d.,-]/g, "");
  if (!raw) return null;
  const x = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(x) ? x : null;
};
const int = (v: unknown): number | null => { const x = money(v); return x == null ? null : Math.max(0, Math.round(x)); };
const str = (v: unknown) => (v == null ? null : String(v).trim() || null);
export function parseQuoteReading(text: string): QuoteReading {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("A IA não devolveu os dados da cotação");
  let o: any;
  try { o = JSON.parse(json); } catch { throw new Error("Resposta da IA inválida"); }
  const date = str(o.data);
  return {
    supplier: str(o.fornecedor), supplier_doc: str(o.cnpj), quote_number: str(o.numero),
    quote_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    payment_terms: str(o.condicao_pagamento),
    // Sem condição escrita, 0 dia é o "não sei" da leitura (vira campo para o comprador digitar), não "à vista".
    payment_days: str(o.condicao_pagamento) ? int(o.prazo_pagamento_dias) : (int(o.prazo_pagamento_dias) || null), delivery_days: int(o.prazo_entrega_dias),
    freight: money(o.frete), total: money(o.total), min_order: money(o.faturamento_minimo),
    items: (Array.isArray(o.itens) ? o.itens : []).map((i: any) => ({
      description: str(i?.descricao) ?? "", quantity: money(i?.quantidade), unit: str(i?.unidade), unit_price: money(i?.valor_unitario),
      total: money(i?.valor_total), sc_item: int(i?.item_sc),
    })).filter((i: { description: string }) => i.description),
  };
}

export const QUOTE_PROMPT = (scItems: string) => `Este arquivo é uma cotação/orçamento de um fornecedor para uma solicitação de compra.
Itens da solicitação de compra (número. quantidade unidade - descrição):
${scItems}

Leia a cotação e devolva SOMENTE um JSON, sem texto em volta, no formato:
{"fornecedor": "razão social ou nome do fornecedor", "cnpj": "CNPJ", "numero": "número da cotação/orçamento", "data": "AAAA-MM-DD",
 "condicao_pagamento": "como está escrito (ex.: 28/35/42 DDL, à vista)", "prazo_pagamento_dias": prazo MÉDIO de pagamento em dias (à vista/antecipado = 0; 28/35/42 = 35),
 "prazo_entrega_dias": prazo de entrega em dias (imediato/pronta entrega = 0), "frete": valor do frete em reais (0 se CIF/incluso), "total": valor total da cotação,
 "faturamento_minimo": valor do faturamento/pedido mínimo em reais (0 se escrito que não há mínimo; null se não estiver escrito),
 "itens": [{"descricao": "descrição do item na cotação", "quantidade": número, "unidade": "unidade como na cotação", "valor_unitario": número, "valor_total": número,
            "item_sc": número do item da solicitação que este item atende, ou null se não atende nenhum}]}
Regras: valores como número (ex.: 1434.98); use null no que não estiver escrito ou estiver ilegível; não invente itens nem valores.`;

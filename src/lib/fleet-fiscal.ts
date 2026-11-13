import type { Rateio } from "./fleet-notes";

/** CC fictício para abastecimentos pagos no ticket: escolhido no Editar, fica fora da tabela da subaba Fiscal. */
export const TICKET_CC = "TICKET";
export const isTicketCc = (cc: string | null | undefined) => (cc ?? "").trim().toUpperCase() === TICKET_CC;

type TicketNote = { total: number | null; approved_at?: string | null; allocation?: unknown; cc_split?: unknown; cc_fix?: string | null };

/**
 * Parte do abastecimento que foi para o CC TICKET (pago no ticket, fora do posto): não desconta do Saldo nem entra
 * nas somas. Mesma prioridade do rateio: aprovado (congelado) → CCs à mão (cc_split) → CC único antigo (cc_fix).
 */
export function ticketValue(n: TicketNote): number {
  const total = Number(n.total ?? 0);
  const alloc = n.approved_at ? (n.allocation as Rateio | null) : null;
  if (alloc?.parts?.length) return alloc.parts.filter((p) => isTicketCc(p.cc)).reduce((s, p) => s + Number(p.value ?? 0), 0);
  const split = (Array.isArray(n.cc_split) ? n.cc_split : []) as { cc_code: string; pct: number }[];
  if (split.length) {
    const sum = split.reduce((s, x) => s + Number(x.pct || 0), 0) || 100;
    return Math.round(split.filter((x) => isTicketCc(x.cc_code)).reduce((s, x) => s + (total * Number(x.pct || 0)) / sum, 0) * 100) / 100;
  }
  return isTicketCc(n.cc_fix) ? total : 0;
}

/** Valor do abastecimento sem a parte TICKET. */
export const nonTicketTotal = (n: TicketNote) => Number(n.total ?? 0) - ticketValue(n);

/** Dias da quinzena cobrada: 1ª = 1 a 15; 2ª = 16 ao último dia do mês. */
export function fortnightRange(year: number, month: number, fortnight: 1 | 2): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return fortnight === 1 ? { from: `${year}-${mm}-01`, to: `${year}-${mm}-15` } : { from: `${year}-${mm}-16`, to: `${year}-${mm}-${last}` };
}

export type CcLine = { cc: string | null; item: string | null; value: number; pct: number };

/**
 * Soma por centro de custo + item conta (sem repetir) das partes do rateio de cada abastecimento.
 * Abastecimento sem rateio (sem programação) entra como "sem CC" para o total bater com a aba Abastecimentos.
 * O CC TICKET fica fora da tabela, do total e das %.
 */
export function ccTotals(rows: { total: number | null; rateio: Rateio | null }[]) {
  const map = new Map<string, CcLine>();
  let ticket = 0;
  const add = (cc: string | null, item: string | null, value: number) => {
    if (isTicketCc(cc)) { ticket += value; return; }
    const k = `${cc ?? ""}|${item ?? ""}`;
    const cur = map.get(k) ?? { cc, item, value: 0, pct: 0 };
    cur.value += value;
    map.set(k, cur);
  };
  for (const r of rows) {
    const parts = r.rateio?.parts ?? [];
    if (!parts.length) { add(null, null, Number(r.total ?? 0)); continue; }
    for (const p of parts) add(p.cc, p.item_account, Number(p.value ?? 0));
  }
  const lines = [...map.values()].map((l) => ({ ...l, value: Math.round(l.value * 100) / 100 }));
  const total = Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100;
  for (const l of lines) l.pct = total ? (l.value / total) * 100 : 0;
  lines.sort((a, b) => (a.cc === null ? 1 : b.cc === null ? -1 : a.cc.localeCompare(b.cc)) || (a.item ?? "").localeCompare(b.item ?? ""));
  const sum = (f: (cc: string) => boolean) => lines.filter((l) => l.cc && f(l.cc)).reduce((s, l) => s + l.value, 0);
  const servicos = sum((cc) => cc.startsWith("2")), industria = sum((cc) => cc.startsWith("1"));
  const share = total ? { servicos: (servicos / total) * 100, industria: (industria / total) * 100, outros: ((total - servicos - industria) / total) * 100 } : { servicos: 0, industria: 0, outros: 0 };
  if (share.outros < 0.005) share.outros = 0;
  return { lines, total, ticket: Math.round(ticket * 100) / 100, share };
}

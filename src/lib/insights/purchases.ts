/**
 * Regras dos blocos vivos de Compras (Solicitações, Validação e Comprador). Usam só as SCs que a página já leu
 * (a RLS/purchase_can_see decide o que a pessoa vê) e deadlineControl para o prazo.
 */
import { deadlineControl, SC_DONE_STATUSES } from "@/lib/purchase-requests";
import { daysBetween } from "@/lib/insights/dates";

export type ScLike = {
  id: string; number: string; stage: string; status: string; status_at: string; created_at: string;
  sent_at: string | null; approved_at: string | null; due_date: string | null; client_id: string | null;
  approver_id: string | null; substitute_id?: string | null; requester_name: string; total_budget: number | null;
};

/** Etapa do quadro "Onde a SC está parada" (encerrada = cancelada/recusada, fora do fluxo). */
export type FlowStage = "rascunho" | "validacao" | "compras" | "comprada" | "encerrada";
export const FLOW_STAGES: { key: Exclude<FlowStage, "encerrada">; label: string }[] = [
  { key: "rascunho", label: "Rascunho" },
  { key: "validacao", label: "Validação" },
  { key: "compras", label: "Compras" },
  { key: "comprada", label: "Comprada" },
];
export const FLOW_LABEL: Record<FlowStage, string> = { rascunho: "Rascunho", validacao: "Validação", compras: "Compras", comprada: "Comprada", encerrada: "Encerrada" };
const BOUGHT = new Set(["COMPRA EFETIVADA", "ALMOXARIFADO"]);

export function flowStage(r: Pick<ScLike, "stage" | "status">): FlowStage {
  if (r.status === "CANCELADA" || r.status === "RECUSADA" || r.stage === "cancelada") return "encerrada";
  if (BOUGHT.has(r.status)) return "comprada";
  if (r.stage === "rascunho") return "rascunho";
  if (r.stage === "aprovacao") return "validacao";
  return "compras";
}

/** Desde quando a SC está na etapa atual (rascunho = criação; validação = envio; compras = validação ou envio; comprada = data do status). */
export function stageSince(r: ScLike): string {
  const st = flowStage(r);
  if (st === "rascunho") return r.created_at.slice(0, 10);
  if (st === "validacao") return (r.sent_at ?? r.created_at).slice(0, 10);
  if (st === "compras") return (r.approved_at ?? r.sent_at ?? r.created_at).slice(0, 10);
  return r.status_at.slice(0, 10);
}

export type StageSummary = { key: Exclude<FlowStage, "encerrada">; label: string; count: number; oldest: { row: ScLike; days: number } | null };

/** Quantas SCs em cada etapa e a mais antiga parada (comprada = só as do mês corrente, para não crescer sem fim). */
export function stageSummary(rows: ScLike[], today: string): StageSummary[] {
  const month = today.slice(0, 7);
  return FLOW_STAGES.map(({ key, label }) => {
    const list = rows.filter((r) => flowStage(r) === key && (key !== "comprada" || r.status_at.slice(0, 7) === month));
    let oldest: StageSummary["oldest"] = null;
    if (key !== "comprada")
      for (const r of list) { const days = daysBetween(stageSince(r), today); if (!oldest || days > oldest.days) oldest = { row: r, days }; }
    return { key, label, count: list.length, oldest };
  });
}

export type QueueItem = { row: ScLike; daysLeft: number; fractionLeft: number; late: boolean; deadline: ReturnType<typeof deadlineControl>["label"] };

/** Fila com contagem regressiva: SCs enviadas e em aberto com prazo, pelo prazo mais próximo. A barra esvazia do envio ao prazo. */
export function urgentQueue(rows: ScLike[], today: string, n = 5): QueueItem[] {
  return rows
    .filter((r) => r.sent_at && r.due_date && !SC_DONE_STATUSES.includes(r.status) && r.stage !== "rascunho" && r.stage !== "cancelada")
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.number.localeCompare(b.number))
    .slice(0, n)
    .map((row) => {
      const due = row.due_date!;
      const total = daysBetween(row.sent_at!.slice(0, 10), due);
      const daysLeft = daysBetween(today, due);
      const fractionLeft = daysLeft <= 0 ? 0 : total <= 0 ? 1 : Math.min(1, daysLeft / total);
      const dl = deadlineControl(row, today).label;
      return { row, daysLeft, fractionLeft, late: dl === "FORA DO PRAZO", deadline: dl };
    });
}

/** Tempo de compra (dias do envio à compra efetivada) das SCs compradas no mês (status_at). Almoxarifado não é compra. */
export function leadTime(rows: ScLike[], month: string) {
  const days = rows
    .filter((r) => r.status === "COMPRA EFETIVADA" && r.sent_at && r.status_at.slice(0, 7) === month)
    .map((r) => Math.max(0, daysBetween(r.sent_at!.slice(0, 10), r.status_at)));
  return { count: days.length, avg: days.length ? days.reduce((s, d) => s + d, 0) / days.length : null };
}

export const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Tempo médio do mês × mês anterior (delta em dias; negativo = mais rápido). */
export function leadTimeTrend(rows: ScLike[], today: string) {
  const cur = leadTime(rows, today.slice(0, 7));
  const prev = leadTime(rows, prevMonth(today.slice(0, 7)));
  return { current: cur, previous: prev, delta: cur.avg != null && prev.avg != null ? cur.avg - prev.avg : null };
}

export type ItemLike = { request_id: string; budget: number | null; status: string };
export type ClientBudget = { clientId: string; budget: number; bought: number };
const ITEM_BOUGHT = new Set(["COMPRADO", "ALMOXARIFADO"]);
const ITEM_OUT = new Set(["CANCELADO", "RECUSADO"]);

/**
 * Verba × comprado por cliente nas SCs enviadas no mês (canceladas/recusadas fora). Verba = soma da verba dos itens
 * (sem verba por item, a verba total da SC); comprado = verba dos itens COMPRADO/ALMOXARIFADO (verba total: proporção dos
 * itens comprados, ou toda se a SC está comprada). Não há valor pago no sistema, então "comprado" é a verba já atendida.
 */
export function budgetVsBought(rows: ScLike[], items: ItemLike[], month: string, top = 5): ClientBudget[] {
  const byReq = new Map<string, ItemLike[]>();
  for (const i of items) byReq.set(i.request_id, [...(byReq.get(i.request_id) ?? []), i]);
  const byClient = new Map<string, ClientBudget>();
  for (const r of rows) {
    if (!r.client_id || !r.sent_at || r.sent_at.slice(0, 7) !== month || flowStage(r) === "encerrada") continue;
    const its = (byReq.get(r.id) ?? []).filter((i) => !ITEM_OUT.has(i.status));
    const itemBudget = its.reduce((s, i) => s + Number(i.budget ?? 0), 0);
    let budget = 0;
    let bought = 0;
    if (itemBudget > 0) {
      budget = itemBudget;
      bought = its.filter((i) => ITEM_BOUGHT.has(i.status)).reduce((s, i) => s + Number(i.budget ?? 0), 0);
    } else {
      budget = Number(r.total_budget ?? 0);
      if (BOUGHT.has(r.status)) bought = budget;
      else if (its.length) bought = budget * (its.filter((i) => ITEM_BOUGHT.has(i.status)).length / its.length);
    }
    if (budget <= 0) continue;
    const c = byClient.get(r.client_id) ?? { clientId: r.client_id, budget: 0, bought: 0 };
    c.budget += budget;
    c.bought += bought;
    byClient.set(r.client_id, c);
  }
  return [...byClient.values()].sort((a, b) => b.budget - a.budget).slice(0, top);
}

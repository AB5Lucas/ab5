/**
 * Comprador › Relação de SCs: uma linha por item da SC (SC do TOTVS sem itens = uma linha da própria SC),
 * com filtros de emissão, situação, solicitante, categoria e tipo, agrupamento e ordem. Regras puras.
 */
import { brDate, brl, deadlineControl, SC_DONE_STATUSES } from "@/lib/purchase-requests";

export type ScReportShow = "abertas" | "concluidas" | "todas";
export type ScReportGroup = "nenhum" | "solicitante" | "cliente" | "categoria";
export type ScReportSort = "prazo_desc" | "prazo_asc" | "natureza";
export type ScReportParams = {
  from: string; to: string; show: ScReportShow; requester: string; category: string; system: string; group: ScReportGroup; sort: ScReportSort;
};
export type ScReportRequest = {
  id: string; number: string; request_date: string; requester_id: string; requester_name: string; system: string; category: string | null;
  nature: string | null; client_id: string | null; due_date: string | null; status: string; status_at: string; sent_at: string | null;
  work_id?: string | null; cc_code?: string | null;
};
export type ScReportItem = {
  request_id: string; item_no: number; quantity: number; unit: string; description: string; budget: number | null;
  work_id: string | null; cc_code: string | null; status: string;
};
export type ScReportRow = {
  number: string; date: string; category: string; item: string; qty: string; unit: string; description: string; budget: string;
  cc: string; costCenter: string; status: string; due: string; deadline: string; requester: string; system: string; nature: string;
  group: string; dueRaw: string | null;
};
export const SC_REPORT_COLUMNS: { key: keyof ScReportRow; label: string; width: number }[] = [
  { key: "number", label: "Nº da solicitação", width: 25 }, { key: "date", label: "Data", width: 14 }, { key: "category", label: "Categoria", width: 18 },
  { key: "item", label: "Item", width: 7 }, { key: "qty", label: "Qtd", width: 8 }, { key: "unit", label: "Un.", width: 8 },
  { key: "description", label: "Descrição", width: 40 }, { key: "budget", label: "Verba", width: 16 }, { key: "cc", label: "CC", width: 14 },
  { key: "costCenter", label: "Centro de custo", width: 26 }, { key: "status", label: "Status", width: 20 }, { key: "due", label: "Prazo", width: 14 },
  { key: "deadline", label: "Controle de prazo", width: 18 }, { key: "requester", label: "Solicitante", width: 20 }, { key: "system", label: "Tipo", width: 12 },
  { key: "nature", label: "Natureza", width: 15 },
];

/** Item encerrado: comprado, no almoxarifado, cancelado ou recusado. */
export const ITEM_DONE = ["COMPRADO", "ALMOXARIFADO", "CANCELADO", "RECUSADO"];

export function buildScReport(
  requests: ScReportRequest[], items: ScReportItem[], p: ScReportParams, today: string,
  ctx: { clientName: (id: string | null) => string; workName: (id: string | null) => string; ccOf: (clientId: string | null, workId: string | null) => string },
): { group: string; rows: ScReportRow[] }[] {
  const byReq = new Map<string, ScReportItem[]>();
  for (const it of items) byReq.set(it.request_id, [...(byReq.get(it.request_id) ?? []), it]);
  const rows: ScReportRow[] = [];
  for (const r of requests) {
    if (p.from && r.request_date < p.from) continue;
    if (p.to && r.request_date > p.to) continue;
    if (p.requester !== "all" && r.requester_id !== p.requester) continue;
    if (p.category !== "all" && (r.category ?? "") !== p.category) continue;
    if (p.system !== "all" && r.system !== p.system) continue;
    const scDone = SC_DONE_STATUSES.includes(r.status);
    const dl = deadlineControl(r, today).label;
    const base = {
      number: r.number, date: brDate(r.request_date), category: r.category ?? "—", due: brDate(r.due_date), deadline: dl,
      requester: r.requester_name, system: r.system, nature: r.nature ?? "—", dueRaw: r.due_date,
      group: p.group === "solicitante" ? r.requester_name : p.group === "cliente" ? ctx.clientName(r.client_id) : p.group === "categoria" ? r.category ?? "Sem categoria" : "",
    };
    const its = (byReq.get(r.id) ?? []).sort((a, b) => a.item_no - b.item_no);
    if (!its.length) {
      // SC do TOTVS (sem itens): uma linha com o centro de custo do cabeçalho.
      const open = !scDone;
      if ((p.show === "abertas" && !open) || (p.show === "concluidas" && open)) continue;
      rows.push({ ...base, item: "—", qty: "—", unit: "—", description: r.system === "TOTVS" ? "SC do TOTVS (itens no TOTVS)" : "—", budget: "—",
        cc: r.cc_code || ctx.ccOf(r.client_id, r.work_id ?? null), costCenter: r.work_id ? ctx.workName(r.work_id) : "Rateio geral", status: r.status });
      continue;
    }
    for (const it of its) {
      // Em aberto = itens ainda pendentes (não as SCs); concluídas = itens encerrados ou SC encerrada.
      const open = !scDone && !ITEM_DONE.includes(it.status);
      if ((p.show === "abertas" && !open) || (p.show === "concluidas" && open)) continue;
      rows.push({
        ...base, item: String(it.item_no), qty: String(it.quantity).replace(".", ","), unit: it.unit, description: it.description,
        budget: it.budget != null ? brl(it.budget) : "—", cc: it.cc_code || ctx.ccOf(r.client_id, it.work_id),
        costCenter: it.work_id ? ctx.workName(it.work_id) : "Rateio geral", status: it.status,
      });
    }
  }
  rows.sort((a, b) => {
    if (p.sort === "natureza") return a.nature.localeCompare(b.nature, "pt-BR") || a.number.localeCompare(b.number, "pt-BR", { numeric: true }) || Number(a.item) - Number(b.item);
    const x = a.dueRaw ?? (p.sort === "prazo_asc" ? "9999" : "0000"), y = b.dueRaw ?? (p.sort === "prazo_asc" ? "9999" : "0000");
    const d = p.sort === "prazo_asc" ? x.localeCompare(y) : y.localeCompare(x);
    return d || a.number.localeCompare(b.number, "pt-BR", { numeric: true }) || Number(a.item) - Number(b.item);
  });
  if (p.group === "nenhum") return [{ group: "", rows }];
  const groups = new Map<string, ScReportRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([group, rows]) => ({ group, rows }));
}

/**
 * Visão de diretoria (página /atividades): a mesma conta do Fechamento (finance-data.ts buildFinanceGroups), agregada
 * por mês, cliente e serviço. Margem de contribuição = faturado por competência × (1 − 18,5%) − mão de obra − transporte −
 * materiais; % = margem ÷ faturado por competência. Meta da empresa: 23%.
 */
import { FIN_TAX } from "./finance-data";
import { buildBase } from "./results-engine";

export const MARGIN_GOAL = 23;

export type MonthAgg = { ym: string; billed: number; comp: number; mo: number; transport: number; materials: number; margin: number; pct: number | null };
export type WorkAgg = { id: string; name: string; client: string; comp: number; margin: number; pct: number | null };
export type ClientAgg = { name: string; billed: number; comp: number; margin: number; pct: number | null };

const pctOf = (margin: number, comp: number) => (comp > 0 ? (margin / comp) * 100 : null);

export function directorSummary(list: any[], rawByWork: Map<string, any>, yms: string[], holidays: string[], allWorks: any[]) {
  const sel = new Set(yms);
  const months = new Map<string, MonthAgg>(yms.map((ym) => [ym, { ym, billed: 0, comp: 0, mo: 0, transport: 0, materials: 0, margin: 0, pct: null }]));
  const works: WorkAgg[] = [];
  for (const w of list) {
    const raw = rawByWork.get(w.id);
    if (!raw) continue;
    const full = buildBase(w, raw, "", "", { isAll: false, workIds: [w.id], holidays, allWorks });
    if (!full) continue;
    const wk = { comp: 0, cost: 0 };
    for (const r of full.rows) {
      const m = months.get(r.ym);
      if (!m) continue;
      m.mo += r.labor; m.transport += r.transport; wk.cost += r.labor + r.transport;
    }
    for (const e of raw.entries as any[]) {
      const v = Number(e.amount) || 0;
      const docYm = String(e.doc_date ?? e.entry_date).slice(0, 7);
      if (e.category === "faturamento" && sel.has(docYm)) months.get(docYm)!.billed += v;
      const ym = String(e.entry_date).slice(0, 7);
      const m = months.get(ym);
      if (!m) continue;
      if (e.category === "faturamento") { m.comp += v; wk.comp += v; }
      else if (e.category === "mao_obra") { m.mo += v; wk.cost += v; }
      else if (e.category === "terceiros") { m.transport += v; wk.cost += v; }
      else if (["materiais", "ferramentas", "andaimes"].includes(e.category)) { m.materials += v; wk.cost += v; }
    }
    if (wk.comp || wk.cost) {
      const margin = wk.comp * (1 - FIN_TAX) - wk.cost;
      works.push({ id: w.id, name: w.name, client: w.clients?.name ?? w.client ?? "Sem cliente", comp: wk.comp, margin, pct: pctOf(margin, wk.comp) });
    }
  }
  const monthList = [...months.values()].map((m) => {
    const margin = m.comp * (1 - FIN_TAX) - m.mo - m.transport - m.materials;
    return { ...m, margin, pct: pctOf(margin, m.comp) };
  });
  const tot = monthList.reduce((a, m) => ({ billed: a.billed + m.billed, comp: a.comp + m.comp, mo: a.mo + m.mo, transport: a.transport + m.transport, materials: a.materials + m.materials }),
    { billed: 0, comp: 0, mo: 0, transport: 0, materials: 0 });
  const margin = tot.comp * (1 - FIN_TAX) - tot.mo - tot.transport - tot.materials;
  const byClient = new Map<string, ClientAgg>();
  for (const w of works) {
    const c = byClient.get(w.client) ?? { name: w.client, billed: 0, comp: 0, margin: 0, pct: null };
    c.comp += w.comp; c.margin += w.margin; byClient.set(w.client, c);
  }
  const clients = [...byClient.values()].map((c) => ({ ...c, billed: c.comp, pct: pctOf(c.margin, c.comp) })).sort((a, b) => b.comp - a.comp);
  // Serviços que puxam a margem para baixo: com faturamento e % abaixo da meta, ou com custo sem faturamento.
  const worst = works.filter((w) => (w.pct != null && w.pct < MARGIN_GOAL) || (!w.comp && w.margin < 0)).sort((a, b) => a.margin - b.margin).slice(0, 6);
  return { months: monthList, totals: { ...tot, margin, pct: pctOf(margin, tot.comp), tax: tot.comp * FIN_TAX }, clients, worst };
}

/** Cobertura de RDO: dias × serviços com mão de obra escalada que têm RDO (qualquer situação; RDO Geral cobre o cliente). */
export function rdoCoverage(
  allocs: { work_id: string; date: string; collaborator_id: string }[],
  rdos: { work_id: string; report_date: string }[],
  workClient: Map<string, { client_id: string | null; general: boolean; internal: boolean }>,
) {
  const has = new Set(rdos.map((r) => `${r.work_id}|${String(r.report_date).slice(0, 10)}`));
  const generalDay = new Set<string>();
  for (const r of rdos) { const w = workClient.get(r.work_id); if (w?.general && w.client_id) generalDay.add(`${w.client_id}|${String(r.report_date).slice(0, 10)}`); }
  const pairs = new Map<string, { work_id: string; date: string }>();
  const people = new Map<string, Set<string>>();
  for (const a of allocs) {
    const w = workClient.get(a.work_id);
    if (!w || w.internal) continue;
    pairs.set(`${a.work_id}|${a.date}`, { work_id: a.work_id, date: a.date });
    const s = people.get(a.date) ?? new Set<string>(); s.add(a.collaborator_id); people.set(a.date, s);
  }
  const byDay = new Map<string, { expected: number; done: number }>();
  const missing: { work_id: string; date: string }[] = [];
  for (const p of pairs.values()) {
    const w = workClient.get(p.work_id)!;
    const ok = has.has(`${p.work_id}|${p.date}`) || (!!w.client_id && generalDay.has(`${w.client_id}|${p.date}`));
    const d = byDay.get(p.date) ?? { expected: 0, done: 0 };
    d.expected++; if (ok) d.done++; else missing.push(p);
    byDay.set(p.date, d);
  }
  const expected = [...byDay.values()].reduce((a, d) => a + d.expected, 0);
  const done = [...byDay.values()].reduce((a, d) => a + d.done, 0);
  const headcount = people.size ? [...people.values()].reduce((a, s) => a + s.size, 0) / people.size : 0;
  return { byDay, expected, done, pct: expected ? (done / expected) * 100 : null, missing, headcount };
}

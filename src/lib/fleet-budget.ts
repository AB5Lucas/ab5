import { bdiBudget, buildBase, monthlyOrderRevenue } from "./results-engine";
import { contractFraction } from "./contract";

/**
 * Transporte orçado de um serviço num mês, pelo mesmo cálculo dos Resultados (inclusive o BDI que segue o realizado):
 * - mensal: o transporte inteiro do mês (BDI sobre os pedidos do mês);
 * - contrato: o transporte × a fração do contrato faturada no mês;
 * - demais: o transporte do serviço × o andamento ganho no mês (% do mês − % anterior).
 */
export function serviceTransportBudget(work: any, raw: any, ym: string, opts: { holidays: string[]; allWorks: any[] }): number {
  const base = buildBase(work, raw, ym, ym, { isAll: false, workIds: [work.id], holidays: opts.holidays, allWorks: opts.allWorks });
  if (!base) return 0;
  const real = Object.fromEntries(base.items.map((i) => [i.key, i.real]));
  if (work.monthly_enabled) {
    const orders = monthlyOrderRevenue(work, ym, ym);
    return orders ? Number(bdiBudget(orders, real, { weights: work.budget_items?.weights })["transporte"] ?? 0) : 0;
  }
  const item = Number(base.items.find((i) => i.key === "transporte")?.budget ?? 0);
  if (!item) return 0;
  if (work.contract_enabled) {
    const billed = [...new Set(((raw.entries ?? []) as any[]).filter((e) => e.work_id === work.id && e.category === "faturamento").map((e) => String(e.entry_date).slice(0, 7)))];
    const months = Number(work.contract_months ?? 12);
    return item * (contractFraction(billed.filter((m) => m <= ym).length, months) - contractFraction(billed.filter((m) => m < ym).length, months));
  }
  const row = base.rows.find((r) => r.ym === ym);
  return row ? (item * Math.max(0, row.advance)) / 100 : 0;
}

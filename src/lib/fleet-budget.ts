import { bdiBudget, buildBase, monthlyOrderRevenue } from "./results-engine";
import { contractFraction } from "./contract";

/** Uma parcela do orçado de transporte do mês, para o detalhamento ao clicar em "Orçado". */
export type BudgetPart = { workId: string; client: string; service: string; rule: string; base: string; value: number };

const isIndustry = (work: any) => /ind[uú]stria/i.test(String(work.clients?.name ?? work.client ?? ""));
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Transporte orçado de um serviço num mês, com os dados dos Resultados:
 * - Indústria: o VT real do mês;
 * - mensal: o transporte inteiro do mês (BDI sobre os pedidos do mês);
 * - sem orçado de transporte preenchido: o transporte real do mês;
 * - contrato: o transporte × a fração do contrato faturada no mês;
 * - demais: o transporte do serviço × o andamento ganho no mês (% do mês − % anterior).
 */
export function serviceTransportBudget(work: any, raw: any, ym: string, opts: { holidays: string[]; allWorks: any[] }): BudgetPart | null {
  const base = buildBase(work, raw, ym, ym, { isAll: false, workIds: [work.id], holidays: opts.holidays, allWorks: opts.allWorks });
  if (!base) return null;
  const part = (rule: string, baseText: string, value: number): BudgetPart | null =>
    value > 0.004 ? { workId: work.id, client: work.clients?.name ?? work.client ?? "Sem cliente", service: work.name ?? "—", rule, base: baseText, value: Math.round(value * 100) / 100 } : null;
  const realItems = Object.fromEntries(base.items.map((i) => [i.key, i.real]));
  const realTransport = Number(realItems["transporte"] ?? 0);

  if (isIndustry(work)) {
    const vt = (base.vtRows ?? []).filter((r: any) => String(r.date).slice(0, 7) === ym).reduce((s: number, r: any) => s + Number(r.cost ?? 0), 0);
    return part("Indústria: VT real do mês", `${(base.vtRows ?? []).filter((r: any) => String(r.date).slice(0, 7) === ym).length} dia(s) com VT`, vt);
  }
  if (work.monthly_enabled) {
    const orders = monthlyOrderRevenue(work, ym, ym);
    if (!orders) return null;
    const value = Number(bdiBudget(orders, realItems, { weights: work.budget_items?.weights })["transporte"] ?? 0);
    return part("Mensal: transporte do mês no BDI", `pedidos do mês ${brl(orders)}`, value);
  }
  const bi = (work.budget_items ?? {}) as Record<string, unknown>;
  const filled = Number(bi["bdi"] ?? 0) === 1 || Number(bi["transporte"] ?? 0) > 0;
  if (!filled) return part("Sem orçado de transporte: real do mês", "transporte real nos Resultados", realTransport);
  const item = Number(base.items.find((i) => i.key === "transporte")?.budget ?? 0);
  if (work.contract_enabled) {
    const billed = [...new Set(((raw.entries ?? []) as any[]).filter((e) => e.work_id === work.id && e.category === "faturamento").map((e) => String(e.entry_date).slice(0, 7)))];
    const months = Number(work.contract_months ?? 12);
    const frac = contractFraction(billed.filter((m) => m <= ym).length, months) - contractFraction(billed.filter((m) => m < ym).length, months);
    return part("Contrato: fração faturada no mês", `${brl(item)} × ${(frac * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, item * frac);
  }
  const row = base.rows.find((r) => r.ym === ym);
  const adv = row ? Math.max(0, row.advance) : 0;
  return part(Number(bi["bdi"] ?? 0) === 1 ? "Andamento do mês (BDI)" : "Andamento do mês", `${brl(item)} × ${adv.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, (item * adv) / 100);
}

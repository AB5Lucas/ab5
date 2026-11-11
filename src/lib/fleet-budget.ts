import { bdiBudget, buildBase, monthlyOrderRevenue } from "./results-engine";
import { contractFraction } from "./contract";

/** Uma parcela do orçado de transporte do mês, para o detalhamento ao clicar em "Orçado". */
export type BudgetPart = { workId: string; clientKey: string; client: string; service: string; rule: string; base: string; value: number };
export type BudgetClient = { key: string; client: string; value: number; rules: string[]; parts: BudgetPart[] };

/** Clientes internos (sem orçado próprio): entram pelo custo real dos veículos no mês. */
const INTERNAL_CLIENTS = /^(ind[uú]stria|adm|comercial|p[aá]tio)$/i;
const clientName = (work: any) => String(work.clients?.name ?? work.client ?? "Sem cliente").trim();
export const isInternalClient = (name: string) => INTERNAL_CLIENTS.test(name.trim());
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * Transporte orçado de um serviço num mês, com os dados dos Resultados. Devolve null só quando o serviço
 * não teve nenhuma atividade no mês (sem custo real, sem pedido e sem andamento):
 * - Indústria, ADM, Comercial e Pátio: o custo real dos veículos no mês (km e pedágio);
 * - mensal: o transporte do mês no BDI dos pedidos do mês;
 * - nada lançado como orçado de transporte: o custo real dos veículos no mês (km e pedágio).
 * - contrato: o transporte × a fração do contrato faturada no mês;
 * - demais: o transporte orçado × o andamento ganho no mês (% do mês − % anterior).
 * VT não entra no que vem do real: a despesa real da frota é só combustível, pedágio, locação e manutenção.
 */
export function serviceTransportBudget(work: any, raw: any, ym: string, opts: { holidays: string[]; allWorks: any[] }): BudgetPart | null {
  const base = buildBase(work, raw, ym, ym, { isAll: false, workIds: [work.id], holidays: opts.holidays, allWorks: opts.allWorks });
  if (!base) return null;
  const realItems = Object.fromEntries(base.items.map((i) => [i.key, i.real]));
  const realTotal = base.items.reduce((s, i) => s + Number(i.real ?? 0), 0);
  // Só a parte dos veículos (km rodado e pedágio) do transporte real; VT e prêmios ficam de fora.
  const vehicleReal = ((base.transportRows ?? []) as { date: string; share: number }[]).filter((t) => t.date.slice(0, 7) === ym).reduce((s, t) => s + Number(t.share ?? 0), 0);
  const row = base.rows.find((r) => r.ym === ym);
  const advance = row ? Math.max(0, row.advance) : 0;
  const orders = work.monthly_enabled ? monthlyOrderRevenue(work, ym, ym) : 0;
  if (realTotal <= 0.004 && !orders && !advance) return null;
  const client = clientName(work);
  const part = (rule: string, baseText: string, value: number): BudgetPart => ({
    workId: work.id, clientKey: work.client_id ?? client, client, service: work.name ?? "—", rule, base: baseText, value: Math.round(Math.max(0, value) * 100) / 100,
  });

  if (isInternalClient(client)) return part("Cliente interno: custo real dos veículos", "km e pedágio dos veículos no mês", vehicleReal);
  if (work.monthly_enabled && orders) {
    return part("Orçado lançado (mensal)", `pedidos do mês ${brl(orders)}`, Number(bdiBudget(orders, realItems, { weights: work.budget_items?.weights })["transporte"] ?? 0));
  }
  const bi = (work.budget_items ?? {}) as Record<string, unknown>;
  const filled = Number(bi["bdi"] ?? 0) === 1 || Number(bi["transporte"] ?? 0) > 0;
  if (!filled || work.monthly_enabled) return part("Sem orçado lançado: custo real dos veículos", "km e pedágio dos veículos no mês", vehicleReal);
  const item = Number(base.items.find((i) => i.key === "transporte")?.budget ?? 0);
  if (work.contract_enabled) {
    const billed = [...new Set(((raw.entries ?? []) as any[]).filter((e) => e.work_id === work.id && e.category === "faturamento").map((e) => String(e.entry_date).slice(0, 7)))];
    const months = Number(work.contract_months ?? 12);
    const frac = contractFraction(billed.filter((m) => m <= ym).length, months) - contractFraction(billed.filter((m) => m < ym).length, months);
    return part("Orçado lançado (contrato)", `${brl(item)} × ${pct(frac * 100)}`, item * frac);
  }
  return part(Number(bi["bdi"] ?? 0) === 1 ? "Orçado lançado (BDI) × andamento" : "Orçado lançado × andamento", `${brl(item)} × ${pct(advance)}`, (item * advance) / 100);
}

/** Agrupa as parcelas por cliente (todos os clientes com atividade no mês, mesmo com orçado zero). */
export function budgetByClient(parts: BudgetPart[]): BudgetClient[] {
  const by = new Map<string, BudgetClient>();
  for (const p of parts) {
    const c = by.get(p.clientKey) ?? { key: p.clientKey, client: p.client, value: 0, rules: [], parts: [] };
    c.value = Math.round((c.value + p.value) * 100) / 100;
    c.parts.push(p);
    if (!c.rules.includes(p.rule)) c.rules.push(p.rule);
    by.set(p.clientKey, c);
  }
  for (const c of by.values()) c.parts.sort((a, b) => b.value - a.value || a.service.localeCompare(b.service, "pt-BR"));
  return [...by.values()].sort((a, b) => b.value - a.value || a.client.localeCompare(b.client, "pt-BR"));
}

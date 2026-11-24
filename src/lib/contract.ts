/** Fração do contrato cumprida = faturamentos ÷ meses (limitada a 0..1). */
export function contractFraction(billings: number, months: number) {
  const m = Math.max(1, Math.floor(months) || 12);
  return Math.min(1, Math.max(0, billings) / m);
}

/**
 * Fração do contrato pelo valor: faturado acumulado ÷ valor do pedido (limitada a 0..1). As parcelas podem ter valores
 * diferentes (ex.: Hyster 2027: 2 de R$ 8.761,15 e 12 de R$ 6.634,00). Sem valor de pedido, cai na contagem de
 * faturamentos ÷ meses.
 */
export function contractValueFraction(billedAmount: number, order: number, billings: number, months: number) {
  if (order > 0) return Math.min(1, Math.max(0, billedAmount) / order);
  return contractFraction(billings, months);
}

type BillEntry = { category?: string | null; entry_date: string; amount: number | string | null; work_id?: string | null };
/** Faturado acumulado e número de meses faturados até o mês (inclusive) a partir dos lançamentos de faturamento. */
export function billedUntil(entries: BillEntry[], untilYm: string, workId?: string) {
  const list = entries.filter((e) => e.category === "faturamento" && (!workId || e.work_id === workId) && String(e.entry_date).slice(0, 7) <= untilYm);
  return { amount: list.reduce((a, e) => a + Number(e.amount ?? 0), 0), months: new Set(list.map((e) => String(e.entry_date).slice(0, 7))).size };
}

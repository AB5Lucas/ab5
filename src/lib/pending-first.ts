/**
 * Listas de ASO, Integrações e Treinamentos: vencidos primeiro, depois os próximos do vencimento (os dois pela data de
 * vencimento, o mais urgente em cima); os demais mantêm a ordem que já tinham.
 */
export function pendingFirst<T>(rows: T[], status: (r: T) => string, expires: (r: T) => string | null | undefined): T[] {
  const rank = (s: string) => (s === "expired" ? 0 : s === "expiring" ? 1 : 2);
  return rows
    .map((r, i) => ({ r, i, k: rank(status(r)), e: expires(r) ?? "" }))
    .sort((a, b) => a.k - b.k || (a.k < 2 ? a.e.localeCompare(b.e) : 0) || a.i - b.i)
    .map((x) => x.r);
}

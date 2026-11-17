/**
 * Listas de ASO, Integrações e Treinamentos: em cima, os vencidos e depois os próximos do vencimento (pela data de
 * vencimento, o mais urgente primeiro) — só os que ainda não estão agendados nem na Conferência. O restante
 * (válidos e os já tratados) vem em ordem alfabética pelo nome.
 */
export function pendingFirst<T>(
  rows: T[],
  status: (r: T) => string,
  expires: (r: T) => string | null | undefined,
  opts: { handled: (r: T) => boolean; name: (r: T) => string },
): T[] {
  const urgent = (r: T) => {
    const s = status(r);
    return (s === "expired" || s === "expiring") && !opts.handled(r);
  };
  const rank = (r: T) => (!urgent(r) ? 2 : status(r) === "expired" ? 0 : 1);
  return rows
    .map((r) => ({ r, k: rank(r), e: expires(r) ?? "", n: opts.name(r) }))
    .sort((a, b) => a.k - b.k || (a.k < 2 ? a.e.localeCompare(b.e) : 0) || a.n.localeCompare(b.n, "pt-BR"))
    .map((x) => x.r);
}

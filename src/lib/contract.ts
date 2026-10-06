/** Fração do contrato cumprida = faturamentos ÷ meses (limitada a 0..1). */
export function contractFraction(billings: number, months: number) {
  const m = Math.max(1, Math.floor(months) || 12);
  return Math.min(1, Math.max(0, billings) / m);
}

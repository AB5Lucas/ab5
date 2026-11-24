/** Funções puras de período em dias (sem calendário/React), para quem só precisa das datas. */

/** Período em dias, no formato "AAAA-MM-DD" (fim incluído). */
export type DayRange = { from: string; to: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Mês atual inteiro (do dia 1 ao último dia). */
export function currentMonthRange(base = new Date()): DayRange {
  return { from: iso(new Date(base.getFullYear(), base.getMonth(), 1)), to: iso(new Date(base.getFullYear(), base.getMonth() + 1, 0)) };
}
/** Meses (AAAA-MM) que o período cobre. */
export function monthsInRange(r: DayRange): string[] {
  const out: string[] = [];
  let [y, m] = r.from.slice(0, 7).split("-").map(Number) as [number, number];
  const end = r.to.slice(0, 7);
  for (let guard = 0; guard < 60; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push(ym);
    if (ym >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

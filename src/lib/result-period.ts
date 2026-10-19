/** Exact month selection from Financeiro; gaps exclude unselected months. */
export function isResultMonth(ym: string, from: string, until: string, selected?: readonly string[]) {
  return (!from || ym >= from) && (!until || ym <= until) && (!selected?.length || selected.includes(ym));
}

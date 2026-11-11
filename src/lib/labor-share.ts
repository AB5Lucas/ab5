/**
 * Rateio da MO: parte das horas de mão de obra do mês em cada cliente ou serviço.
 * As horas vêm de allocationHours (RDO quando existe, senão o horário do serviço).
 */
export type LaborShareBy = "cliente" | "servico";
export type WorkInfo = { client: string; clientKey: string; name: string };
export type LaborShareRow = { key: string; label: string; client: string; hours: number; people: number; pct: number };

export function laborShare(rows: { work_id: string; collaborator_id: string; hours: number }[], works: Map<string, WorkInfo>, by: LaborShareBy): LaborShareRow[] {
  const groups = new Map<string, { label: string; client: string; hours: number; people: Set<string> }>();
  let total = 0;
  for (const r of rows) {
    if (!(r.hours > 0)) continue;
    const w = works.get(r.work_id);
    if (!w) continue;
    const key = by === "cliente" ? w.clientKey : r.work_id;
    const g = groups.get(key) ?? { label: by === "cliente" ? w.client : w.name, client: w.client, hours: 0, people: new Set<string>() };
    g.hours += r.hours;
    g.people.add(r.collaborator_id);
    groups.set(key, g);
    total += r.hours;
  }
  return [...groups]
    .map(([key, g]) => ({ key, label: g.label, client: g.client, hours: Math.round(g.hours * 100) / 100, people: g.people.size, pct: total ? (g.hours / total) * 100 : 0 }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label, "pt-BR"));
}

/** "2026-11" → primeiro e último dia do mês. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

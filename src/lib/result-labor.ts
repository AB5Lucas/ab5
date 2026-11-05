export type ResultAbsences = {
  daysOff?: { collaborator_id: string; date: string; end_date: string | null }[];
  vacations?: { collaborator_id: string; start_date: string; end_date: string | null }[];
  leaves?: { collaborator_id: string; start_date: string; end_date: string | null }[];
  noVtRows?: { collaborator_id: string; daily_schedules?: { schedule_date: string } | null }[];
};

/** Registered absence ranges are inclusive; a single-day folga has no end date. */
export function resultAbsenceCheck(raw: ResultAbsences) {
  const ranges = new Map<string, { start: string; end: string }[]>();
  const add = (id: string, start: string, end: string | null) => {
    const list = ranges.get(id) ?? [];
    list.push({ start, end: end ?? start });
    ranges.set(id, list);
  };
  for (const r of raw.daysOff ?? []) add(r.collaborator_id, r.date, r.end_date);
  for (const r of [...(raw.vacations ?? []), ...(raw.leaves ?? [])]) add(r.collaborator_id, r.start_date, r.end_date);
  for (const r of raw.noVtRows ?? []) {
    const date = r.daily_schedules?.schedule_date;
    if (date) add(r.collaborator_id, date, date);
  }
  return (id: string, date: string) => (ranges.get(id) ?? []).some((r) => r.start <= date && date <= r.end);
}

/** Absences never create worked days; otherwise preserve the four RDO precedence cases. */
export function resultHours(row: any, hasWorkRdo: boolean, hasOtherClientRdo = false, absent = false): number {
  if (absent) return 0;
  if (row) return row.present ? Math.max(0, Number(row.worked_hours ?? 8)) : 0;
  return hasOtherClientRdo || hasWorkRdo ? 0 : 8;
}

export function marginPercent(margin: number, revenue: number): number | null {
  return revenue > 0 ? (margin / revenue) * 100 : null;
}

/** Keep the existing arithmetic mean, but never manufacture a percentage for an undefined denominator. */
export function meanMarginPercent(values: (number | null)[], margin: number): number | null {
  if (!values.length || values.some((v) => v === null)) return null;
  const average = values.reduce<number>((s, v) => s + (v ?? 0), 0) / values.length;
  return margin < 0 && average >= 0 ? null : average;
}

export function supportDailyWeights(allocs: any[], rdos: any[], headers: any[], supportIds: Set<string>, otherClientRdos: any[] = [], absent: (id: string, date: string) => boolean = () => false) {
  const days = new Set<string>([...headers, ...rdos].map((r) => `${r.work_id}|${String(r.report_date).slice(0, 10)}`));
  const elsewhere = new Set<string>(otherClientRdos.map((r) => `${r.collaborator_id}|${r.report_date}`));
  const byPerson = new Map<string, any>(rdos.map((r) => [`${r.collaborator_id}|${r.report_date}`, r]));
  const weights = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  const allocated = new Set<string>();
  const add = (wid: string, date: string, h: number) => {
    if (!wid || h <= 0) return;
    const m = weights.get(date) ?? new Map<string, number>();
    m.set(wid, (m.get(wid) ?? 0) + h);
    weights.set(date, m);
  };
  for (const a of allocs) {
    const dt = a.daily_schedules?.schedule_date;
    if (!dt || !a.collaborator_id) continue;
    const key = `${a.collaborator_id}|${dt}`;
    allocated.add(key);
    if (supportIds.has(a.collaborator_id) || seen.has(key)) continue;
    seen.add(key);
    const rdo = byPerson.get(key);
    add(rdo?.work_id ?? a.work_id, dt, resultHours(rdo, days.has(`${a.work_id}|${dt}`), elsewhere.has(key), absent(a.collaborator_id, dt)));
  }
  // Unscheduled people explicitly present in an RDO are valid activity weights, not extra costs.
  for (const r of rdos) {
    const key = `${r.collaborator_id}|${r.report_date}`;
    if (!r.collaborator_id || allocated.has(key) || supportIds.has(r.collaborator_id) || seen.has(key)) continue;
    seen.add(key);
    add(r.work_id, r.report_date, resultHours(r, true, false, absent(r.collaborator_id, r.report_date)));
  }
  return weights;
}

export function supportShare(weights: Map<string, Map<string, number>>, date: string, sourceWork: string, selected: Set<string>): number {
  const m = weights.get(date);
  const total = [...(m?.values() ?? [])].reduce((s, h) => s + h, 0);
  if (!total) return selected.has(sourceWork) ? 1 : 0;
  return [...(m?.entries() ?? [])].reduce((s, [wid, h]) => s + (selected.has(wid) ? h : 0), 0) / total;
}
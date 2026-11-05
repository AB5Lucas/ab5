import { resultHours, resultAbsenceCheck, supportDailyWeights, type ResultAbsences } from "./result-labor";

type Work = { id: string; client_id: string | null };
type Allocation = { work_id: string | null; collaborator_id: string | null; daily_schedules: { schedule_date: string } | null };
type Row = { work_id: string; collaborator_id: string | null; report_date: string; present: boolean; worked_hours: number | null };
type Header = { work_id: string; report_date: string };

/** Same daily attendance precedence as Results, with no month-wide RDO shortcut. */
export function purchaseMonthHours(works: Work[], allocations: Allocation[], rows: Row[], headers: Header[], supports: { client_id: string; collaborator_id: string }[] = [], absences: ResultAbsences = {}) {
  const absent = resultAbsenceCheck(absences);
  const totals = new Map<string, number>();
  const add = (id: string | null, hours: number) => { if (id && hours > 0) totals.set(id, (totals.get(id) ?? 0) + hours); };
  for (const clientId of new Set(works.map((w) => w.client_id))) {
    const ids = new Set(works.filter((w) => w.client_id === clientId).map((w) => w.id));
    const ownRows = rows.filter((r) => ids.has(r.work_id));
    const ownAllocations = allocations.filter((a) => ids.has(a.work_id ?? ""));
    const ownHeaders = headers.filter((h) => ids.has(h.work_id));
    const byPerson = new Map(ownRows.map((r) => [`${r.collaborator_id}|${r.report_date}`, r]));
    const elsewhere = new Set(rows.filter((r) => !ids.has(r.work_id)).map((r) => `${r.collaborator_id}|${r.report_date}`));
    const days = new Set([...ownHeaders, ...ownRows].map((r) => `${r.work_id}|${r.report_date}`));
    const supportIds = new Set(supports.filter((s) => s.client_id === clientId).map((s) => s.collaborator_id));
    const weights = supportDailyWeights(ownAllocations, ownRows, ownHeaders, supportIds, rows.filter((r) => !ids.has(r.work_id)), absent);
    const seen = new Set<string>();
    const distribute = (id: string | null, date: string, person: string, hours: number) => {
      const daily = supportIds.has(person) ? weights.get(date) : undefined;
      const total = [...(daily?.values() ?? [])].reduce((s, h) => s + h, 0);
      if (total > 0) for (const [wid, weight] of daily ?? []) add(wid, hours * weight / total);
      else add(id, hours);
    };
    for (const a of ownAllocations) {
      const date = a.daily_schedules?.schedule_date;
      if (!date || !a.collaborator_id) continue;
      const key = `${a.collaborator_id}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      distribute(a.work_id, date, a.collaborator_id, resultHours(byPerson.get(key), days.has(`${a.work_id}|${date}`), elsewhere.has(key), absent(a.collaborator_id, date)));
    }
    for (const r of ownRows) {
      const key = `${r.collaborator_id}|${r.report_date}`;
      if (!r.collaborator_id || seen.has(key)) continue;
      seen.add(key);
      distribute(r.work_id, r.report_date, r.collaborator_id, resultHours(r, true, false, absent(r.collaborator_id, r.report_date)));
    }
  }
  return totals;
}
export type AllocationHourRow = { work_id: string; collaborator_id: string; name: string; date: string; hours: number };
export type AllocationHourInput = {
  collaborator_id: string | null;
  daily_schedules: { schedule_date: string } | null;
  collaborators: { full_name: string } | null;
  works: { id: string; entry_time: string | null; exit_time: string | null; exit_time_weekend: string | null; night_shift: boolean | null } | null;
};

export function allocationHours(allocations: AllocationHourInput[], records: AllocationHourRow[], reports: { work_id: string; report_date: string }[]): AllocationHourRow[] {
  const reportDays = new Set(reports.map(r => `${r.work_id}|${r.report_date}`));
  const rows = new Map(records.map(r => [`${r.work_id}|${r.date}|${r.collaborator_id}`, r]));
  for (const a of allocations) {
    const work = a.works, date = a.daily_schedules?.schedule_date, person = a.collaborator_id;
    if (!work || !date || !person) continue;
    const key = `${work.id}|${date}|${person}`;
    if (rows.has(key) || reportDays.has(`${work.id}|${date}`)) continue;
    const reducedDay = [0, 5, 6].includes(new Date(`${date}T12:00:00`).getDay());
    const entry = work.night_shift ? "21:30" : work.entry_time ?? "07:00";
    const exit = work.night_shift ? "05:30" : reducedDay ? work.exit_time_weekend ?? "16:00" : work.exit_time ?? "17:00";
    const minutes = (t: string) => { const [h = 0, m = 0] = t.split(":").map(Number); return h * 60 + m; };
    let span = minutes(exit) - minutes(entry);
    if (span < 0) span += 1440;
    const hours = Math.max(0, Math.round((span - 60) / 60 * 100) / 100);
    rows.set(key, { work_id: work.id, collaborator_id: person, name: a.collaborators?.full_name ?? "—", date, hours });
  }
  return [...rows.values()];
}
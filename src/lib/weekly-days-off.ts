const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Folga semanal: quem trabalhou no sábado E no domingo tem direito a uma folga
 * na semana seguinte (segunda a domingo), ou na outra, se preferir. `date` é qualquer dia dessa semana.
 */
export type FolgaWeek = { saturday: string; sunday: string; days: string[]; window: string[] };
/** Semanas em que a folga pode cair: a semana logo após o fim de semana e a seguinte. */
export const FOLGA_WEEKS = 2;

/** Semana (segunda → domingo) de `date` e o fim de semana trabalhado logo antes dela. */
export function folgaWeekOf(date: string): FolgaWeek {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const monday = addDays(date, weekday === 0 ? -6 : 1 - weekday);
  return {
    saturday: addDays(monday, -2),
    sunday: addDays(monday, -1),
    days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    window: Array.from({ length: 7 * FOLGA_WEEKS }, (_, i) => addDays(monday, i)),
  };
}

/** Quem tem alocação nos dois dias do fim de semana. */
export function entitledToFolga(weekend: { saturday: string[]; sunday: string[] }): string[] {
  const sunday = new Set(weekend.sunday);
  return [...new Set(weekend.saturday.filter((id) => sunday.has(id)))];
}

export type DayOffRow = { collaborator_id: string; date: string; end_date: string | null };

/** Dias da janela (esta semana e a seguinte) em que cada pessoa já tem folga (cadastro de folgas ou caixa FOLGAS). */
export function folgaDaysBy(week: FolgaWeek, daysOff: DayOffRow[], folgaBox: { collaborator_id: string; date: string }[]) {
  const out = new Map<string, Set<string>>();
  const put = (id: string, d: string) => {
    if (!week.window.includes(d)) return;
    const s = out.get(id) ?? new Set<string>();
    s.add(d);
    out.set(id, s);
  };
  for (const r of daysOff) for (const d of week.window) if (r.date <= d && (r.end_date ?? r.date) >= d) put(r.collaborator_id, d);
  for (const r of folgaBox) put(r.collaborator_id, r.date);
  return new Map([...out].map(([id, s]) => [id, [...s].sort()]));
}

const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "Seg 16/11" */
export const folgaDayLabel = (iso: string) => `${WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${br(iso)}`;

/** Texto para copiar (WhatsApp): quem tem direito, com e sem folga agendada. */
export function folgaListText(week: FolgaWeek, people: { name: string; days: string[] }[], today: string): string {
  const withDay = people.filter((p) => p.days.length);
  const without = people.filter((p) => !p.days.length);
  const lines = [`*FOLGAS · fim de semana ${br(week.saturday)} e ${br(week.sunday)}*`, `${people.length} com direito`];
  lines.push("", `*Com folga agendada (${withDay.length})*`);
  if (withDay.length) for (const p of withDay) lines.push(`${p.name} – ${p.days.map((d) => `${folgaDayLabel(d)}${d < today ? " (folgou)" : ""}`).join(", ")}`);
  else lines.push("Ninguém");
  lines.push("", `*Sem folga agendada (${without.length})*`);
  if (without.length) for (const p of without) lines.push(p.name);
  else lines.push("Ninguém");
  return lines.join("\n");
}

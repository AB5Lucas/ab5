export type ShiftDay = { start: string; end: string };
/** Chaves "0".."6" = getDay() (0 = domingo). Dia ausente = folga. */
export type ShiftSchedule = Record<string, ShiftDay>;

export const DAYS = [
  { key: "1", label: "Segunda", short: "Seg" },
  { key: "2", label: "Terça", short: "Ter" },
  { key: "3", label: "Quarta", short: "Qua" },
  { key: "4", label: "Quinta", short: "Qui" },
  { key: "5", label: "Sexta", short: "Sex" },
  { key: "6", label: "Sábado", short: "Sáb" },
  { key: "0", label: "Domingo", short: "Dom" },
];

export function describeShift(s: ShiftSchedule) {
  const parts: string[] = [];
  for (const d of DAYS) {
    const v = s?.[d.key];
    if (v) parts.push(`${d.short} ${v.start}–${v.end}`);
  }
  return parts.length ? parts.join(" · ") : "Sem horários";
}

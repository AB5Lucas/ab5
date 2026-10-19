/** Custo de mão de obra com adicionais.
 * Dia útil: até STANDARD_HOURS × 1; horas extras × 1,6.
 * Sábado: todas as horas × 1,6. Domingo/feriado: todas × 2.
 * Adicional noturno (serviço noturno): +50% sobre as horas entre 22h e 05h.
 * Depois × encargos (2,6; PJ × 1). */
export const STANDARD_HOURS = 8;
export const ENCARGOS = 2.6;
export const NIGHT_PREMIUM = 0.5;

const toMin = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + (m ?? 0);
};

/** Horas trabalhadas dentro da janela 22:00–05:00 (intervalo descontado dessas horas). */
export function nightHours(entry?: string | null, exit?: string | null, breakMin = 60) {
  const e = toMin(entry), x0 = toMin(exit);
  if (e == null || x0 == null) return 0;
  let x = x0;
  if (x <= e) x += 24 * 60;
  let overlap = 0;
  // Janelas noturnas: [-2h,5h], [22h,29h], [46h,53h] em minutos a partir de 00:00 do dia de entrada
  for (const [a, b] of [[-120, 300], [1320, 1740], [2760, 3180]]) overlap += Math.max(0, Math.min(x, b!) - Math.max(e, a!));
  const worked = Math.max(0, x - e - breakMin);
  return Math.round((Math.min(worked, Math.max(0, overlap - breakMin)) / 60) * 100) / 100;
}

export function laborCost(hours: number, rate: number, isPj: boolean, date: string, holidays: Set<string>, nightH = 0) {
  const dow = new Date(date + "T12:00:00").getDay();
  let eq: number;
  if (dow === 0 || holidays.has(date)) eq = hours * 2;
  else if (dow === 6) eq = hours * 1.6;
  else eq = Math.min(hours, STANDARD_HOURS) + Math.max(0, hours - STANDARD_HOURS) * 1.6;
  eq += Math.min(nightH, hours) * NIGHT_PREMIUM;
  return eq * rate * (isPj ? 1 : ENCARGOS);
}

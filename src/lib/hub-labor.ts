/** HUB: custo de MO das escalações separado em horas normais e horas extras (mesmas regras de labor-cost.ts).
 * Dia útil: até 8 h = normal; acima = HE × 1,6. Sábado = tudo HE × 1,6; domingo/feriado = tudo HE × 2. × encargos (PJ × 1). */
import { ENCARGOS, STANDARD_HOURS } from "./labor-cost";

export function laborSplit(hours: number, rate: number, isPj: boolean, date: string, holidays: Set<string>) {
  const enc = rate * (isPj ? 1 : ENCARGOS);
  const dow = new Date(date + "T12:00:00").getDay();
  if (dow === 0 || holidays.has(date)) return { normal: 0, extra: hours * 2 * enc, normalH: 0, extraH: hours };
  if (dow === 6) return { normal: 0, extra: hours * 1.6 * enc, normalH: 0, extraH: hours };
  const n = Math.min(hours, STANDARD_HOURS), x = Math.max(0, hours - STANDARD_HOURS);
  return { normal: n * enc, extra: x * 1.6 * enc, normalH: n, extraH: x };
}

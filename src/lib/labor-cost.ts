/** Custo de mão de obra com adicionais.
 * Dia útil: até STANDARD_HOURS × 1; horas extras × 1,6.
 * Sábado: todas as horas × 1,6. Domingo/feriado: todas × 2.
 * Depois × encargos (2,6; PJ × 1). */
export const STANDARD_HOURS = 8;
export const ENCARGOS = 2.6;

export function laborCost(hours: number, rate: number, isPj: boolean, date: string, holidays: Set<string>) {
  const dow = new Date(date + "T12:00:00").getDay();
  let eq: number;
  if (dow === 0 || holidays.has(date)) eq = hours * 2;
  else if (dow === 6) eq = hours * 1.6;
  else eq = Math.min(hours, STANDARD_HOURS) + Math.max(0, hours - STANDARD_HOURS) * 1.6;
  return eq * rate * (isPj ? 1 : ENCARGOS);
}

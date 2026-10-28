export function prizePeriod(month: string) {
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 2, 26));
  const end = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 1, 25));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function prizeMultiplier(date: string, holidays: string[]): number | null {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || holidays.includes(date)) return 2;
  return day === 6 ? 1.6 : null;
}

export function prizeDates(month: string, holidays: string[]): string[] {
  const { start, end } = prizePeriod(month);
  const dates: string[] = [];
  for (const day = new Date(`${start}T12:00:00Z`); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (prizeMultiplier(date, holidays)) dates.push(date);
  }
  return dates;
}

export const prizeAmount = (hours: number, rate: number, multiplier: number) => Math.round(hours * rate * multiplier * 100) / 100;
export const canManagePrizeHours = (role: string) => role === "admin" || role === "programmer";
/** Thirty calendar days, including the dashboard's local today. */
export function fleetRankingPeriod(today: string) {
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: today };
}
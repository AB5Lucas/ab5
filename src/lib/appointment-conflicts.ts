/** Without a requested time, an absence still conflicts with the entire day. */
export function appointmentTimesConflict(existing: string | null, requested?: string): boolean {
  if (!requested || !existing) return true;
  return existing.slice(0, 5) === requested.slice(0, 5);
}
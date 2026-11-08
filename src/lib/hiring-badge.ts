export function hiringBadge(requests: { status: string | null }[]) {
  const pending = requests.filter((r) => !["atendida", "cancelada"].includes(r.status ?? ""));
  if (!pending.length) return undefined;
  return { count: pending.length, tone: pending.some((r) => !r.status || r.status === "aberta") ? "red" as const : "orange" as const };
}
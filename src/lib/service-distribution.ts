export type DistributionWork = { id: string; client_id: string | null; active: boolean };
export type DistributionAllocation = { work_id: string; collaborator_id: string; service_assigned: boolean };

export function serviceDistribution(
  works: DistributionWork[],
  allocations: DistributionAllocation[],
  excluded: ReadonlySet<string> = new Set(),
) {
  const byWork = new Map(works.map((w) => [w.id, w]));
  const activeByClient = new Map<string, Set<string>>();
  for (const w of works) {
    if (!w.active || !w.client_id) continue;
    const ids = activeByClient.get(w.client_id) ?? new Set<string>();
    ids.add(w.id);
    activeByClient.set(w.client_id, ids);
  }
  const pendingClients = new Set<string>();
  for (const a of allocations) {
    if (excluded.has(a.collaborator_id)) continue;
    const clientId = byWork.get(a.work_id)?.client_id;
    if (!clientId) continue;
    if (!a.service_assigned && (activeByClient.get(clientId)?.size ?? 0) > 1) pendingClients.add(clientId);
  }
  return { pendingClients: pendingClients.size, pendingClientIds: [...pendingClients] };
}

/** Ontem até sete dias atrás (7 dias; hoje nunca entra no contador). */
export function recentRange(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  return { start: new Date(d.getTime() - 7 * 86400000).toISOString().slice(0, 10), end: new Date(d.getTime() - 86400000).toISOString().slice(0, 10) };
}

/** Três Corações só é sinalizada no sábado e domingo. */
export const isTresCoracoes = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("tres coracoes");
/** Indústria nunca é sinalizada na aba Serviços (pedido do usuário: sem escalação nos serviços é normal). */
export const isIndustria = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase() === "INDUSTRIA";
export const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

/** Une os clientes pendentes de vários dias: cada cliente conta uma única vez. */
export function mergePendingClients(days: { pendingClientIds: string[] }[]) {
  const ids = new Set(days.flatMap((d) => d.pendingClientIds));
  return { pendingClients: ids.size, pendingClientIds: [...ids] };
}

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
  const occupied = new Set<string>();
  for (const a of allocations) {
    if (excluded.has(a.collaborator_id)) continue;
    const clientId = byWork.get(a.work_id)?.client_id;
    if (!clientId) continue;
    if (a.service_assigned) occupied.add(a.work_id);
    else if ((activeByClient.get(clientId)?.size ?? 0) > 1) pendingClients.add(clientId);
  }
  const emptyByClient: Record<string, number> = {};
  for (const [clientId, ids] of activeByClient) {
    emptyByClient[clientId] = [...ids].filter((id) => !occupied.has(id)).length;
  }
  return { pendingClients: pendingClients.size, emptyByClient };
}
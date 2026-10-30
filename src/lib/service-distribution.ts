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
type WorkScope = { id: string; client_id: string | null };
type WorkAssignment = { work_id: string; works: { client_id: string | null } | null };

/** UI scope only; database policies remain the authorization boundary. */
export function resultWorksForRole<T extends WorkScope>(works: T[], role: string, assignments: WorkAssignment[]): T[] {
  const workIds = new Set(assignments.map((link) => link.work_id));
  if (role === "coordenador") {
    const clientIds = new Set(assignments.flatMap((link) => link.works?.client_id ? [link.works.client_id] : []));
    return works.filter((work) => workIds.has(work.id) || (work.client_id !== null && clientIds.has(work.client_id)));
  }
  if (role === "encarregado" || role === "cliente") return works.filter((work) => workIds.has(work.id));
  return works;
}
/**
 * Regras dos blocos vivos de Atividades (Programação, Serviços e Relatório Diário):
 * Pulso do dia, RDOs do dia, dias seguidos sem folga. A distribuição pendente usa lib/service-distribution.ts.
 */
import { addDaysIso } from "@/lib/insights/dates";

export type PulseKey = "obra" | "compromisso" | "folga" | "atestado" | "ferias" | "outros";
export const PULSE_LABEL: Record<PulseKey, string> = {
  obra: "Em obra", compromisso: "Treinamento/integração/ASO", folga: "Folga", atestado: "Atestado", ferias: "Férias", outros: "Outros quadros",
};
/** Rótulo do quadro na Programação (para rolar até ele). */
export const PULSE_BOX_LABEL: Partial<Record<PulseKey, string[]>> = {
  compromisso: ["TREINAMENTO", "INTEGRAÇÃO", "ASO"], folga: ["FOLGAS"], atestado: ["ATESTADO", "MÉDICO"], ferias: ["FÉRIAS"],
};

const COMMIT_BOXES = (k: string) => k === "aso" || k === "treinamento" || k.startsWith("integracao");

/**
 * Situação de cada pessoa no dia (uma só, nesta ordem): obra > treinamento/integração/ASO (quadro ou agendamento) >
 * férias > atestado > folga > outros quadros (falta, licença…). Escalados = todos que aparecem na Programação do dia.
 */
export function dayPulse(input: {
  allocations: { collaborator_id: string }[];
  boxes: { collaborator_id: string; box_key: string }[];
  appointments: { collaborator_id: string }[];
  vacations: { collaborator_id: string }[];
  medical: { collaborator_id: string }[];
  daysOff: { collaborator_id: string }[];
}) {
  const status = new Map<string, PulseKey>();
  const set = (id: string, k: PulseKey) => { if (!status.has(id)) status.set(id, k); };
  for (const a of input.allocations) set(a.collaborator_id, "obra");
  for (const b of input.boxes) if (COMMIT_BOXES(b.box_key)) set(b.collaborator_id, "compromisso");
  for (const a of input.appointments) set(a.collaborator_id, "compromisso");
  for (const v of input.vacations) set(v.collaborator_id, "ferias");
  for (const b of input.boxes) if (b.box_key === "ferias") set(b.collaborator_id, "ferias");
  for (const m of input.medical) set(m.collaborator_id, "atestado");
  for (const b of input.boxes) if (b.box_key === "atestado" || b.box_key === "medico") set(b.collaborator_id, "atestado");
  for (const d of input.daysOff) set(d.collaborator_id, "folga");
  for (const b of input.boxes) if (b.box_key === "folga") set(b.collaborator_id, "folga");
  for (const b of input.boxes) set(b.collaborator_id, "outros");
  const counts: Record<PulseKey, number> = { obra: 0, compromisso: 0, folga: 0, atestado: 0, ferias: 0, outros: 0 };
  for (const k of status.values()) counts[k]++;
  return { total: status.size, counts, status };
}

export type RdoTileStatus = "final" | "draft" | "none";
export type RdoTile = { workId: string; name: string; clientName: string; people: number; status: RdoTileStatus; rdoStatus: string | null };

/** Um quadradinho por serviço com equipe no dia: verde = RDO finalizado/aprovado, amarelo = rascunho, cinza = sem RDO. */
export function rdoTiles(
  allocations: { collaborator_id: string; work_id: string }[],
  rdos: { work_id: string; status: string }[],
  works: ReadonlyMap<string, { name: string; clientName: string }>,
): RdoTile[] {
  const people = new Map<string, Set<string>>();
  for (const a of allocations) people.set(a.work_id, (people.get(a.work_id) ?? new Set()).add(a.collaborator_id));
  const rdoBy = new Map<string, string>();
  for (const r of rdos) if (!rdoBy.has(r.work_id) || r.status !== "draft") rdoBy.set(r.work_id, r.status);
  return [...people].map(([workId, ids]) => {
    const st = rdoBy.get(workId) ?? null;
    const w = works.get(workId);
    return {
      workId, name: w?.name ?? "Serviço", clientName: w?.clientName ?? "", people: ids.size, rdoStatus: st,
      status: (st == null ? "none" : st === "draft" ? "draft" : "final") as RdoTileStatus,
    };
  }).sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
}

export type Streak = { collaboratorId: string; days: number; since: string };

/**
 * Dias seguidos escalados em obra até `date` (inclusive), sem folga/ausência: conta para trás enquanto a pessoa tem
 * alocação no dia e nenhuma ausência. Só quem está escalado em `date`. Limite = dias lidos.
 */
export function restStreaks(
  date: string,
  workedByDay: ReadonlyMap<string, ReadonlySet<string>>,
  absentByDay: ReadonlyMap<string, ReadonlySet<string>>,
  min = 6,
  maxDays = 30,
): Streak[] {
  const today = workedByDay.get(date);
  if (!today) return [];
  const out: Streak[] = [];
  for (const id of today) {
    let n = 0;
    let d = date;
    while (n < maxDays && workedByDay.get(d)?.has(id) && !absentByDay.get(d)?.has(id)) { n++; d = addDaysIso(d, -1); }
    if (n >= min) out.push({ collaboratorId: id, days: n, since: addDaysIso(date, -(n - 1)) });
  }
  return out.sort((a, b) => b.days - a.days || a.collaboratorId.localeCompare(b.collaboratorId));
}

/** Ausências por dia (folga, férias, atestado) a partir de intervalos. */
export function absencesByDay(
  from: string, to: string,
  ranges: { collaborator_id: string; start: string; end: string | null }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of ranges) {
    const end = (r.end ?? r.start) < to ? (r.end ?? r.start) : to;
    for (let d = r.start < from ? from : r.start; d <= end; d = addDaysIso(d, 1)) m.set(d, (m.get(d) ?? new Set()).add(r.collaborator_id));
  }
  return m;
}

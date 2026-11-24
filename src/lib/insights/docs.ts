/**
 * Regras dos blocos vivos da Documentação (Radar de vencimentos, Bloqueados para amanhã, Turmas se formando,
 * Prontidão por cliente). Validade/situação sempre por doc-status.ts e scheduling.ts (mesma regra da Programação).
 */
import { latestByKey } from "@/lib/doc-status";
import {
  asoBlocksWork, checkAso, checkIntegration, checkRequirements, formatDateBR, workRequiresIntegration, type ScheduleContext,
} from "@/lib/scheduling";

export type DocKind = "aso" | "treinamento" | "integracao";
export const DOC_KIND_LABEL: Record<DocKind, string> = { aso: "ASO", treinamento: "Treinamento", integracao: "Integração" };
/** Subaba da Documentação de cada tipo de documento. */
export const DOC_KIND_TAB: Record<DocKind, "asos" | "treinamentos" | "integracoes"> = { aso: "asos", treinamento: "treinamentos", integracao: "integracoes" };

export type ExpiringDoc = { key: string; collaboratorId: string; name: string; kind: DocKind; label: string; expires: string };

/** Dias inteiros de `from` até `to` (datas ISO). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86400000);

export const addDaysIso = (d: string, n: number) => {
  const x = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Urgência pelo número de dias até vencer: até 7 = vermelho, até 30 = laranja, depois verde. */
export function urgencyTone(days: number): "red" | "orange" | "green" {
  if (days <= 7) return "red";
  if (days <= 30) return "orange";
  return "green";
}

/**
 * Documento vigente de cada pessoa ativa (registro de vencimento mais distante por pessoa × ASO / treinamento / cliente).
 * Sem vencimento = não vence (fica fora do radar).
 */
export function currentDocs(input: {
  people: ReadonlyMap<string, string>;
  asos: { collaborator_id: string; expires_at: string | null }[];
  trainings: { collaborator_id: string; training_id: string; expires_at: string | null }[];
  integrations: { collaborator_id: string; client_id: string; expires_at: string | null }[];
  trainingName: ReadonlyMap<string, string>;
  clientName: ReadonlyMap<string, string>;
}): ExpiringDoc[] {
  const out: ExpiringDoc[] = [];
  const push = (kind: DocKind, key: string, collaboratorId: string, label: string, expires: string | null) => {
    const name = input.people.get(collaboratorId);
    if (!name || !expires) return;
    out.push({ key: `${kind}|${key}`, collaboratorId, name, kind, label, expires: expires.slice(0, 10) });
  };
  for (const a of latestByKey(input.asos, (x) => x.collaborator_id).values()) push("aso", a.collaborator_id, a.collaborator_id, "ASO", a.expires_at);
  for (const t of latestByKey(input.trainings, (x) => `${x.collaborator_id}|${x.training_id}`).values())
    push("treinamento", `${t.collaborator_id}|${t.training_id}`, t.collaborator_id, input.trainingName.get(t.training_id) ?? "Treinamento", t.expires_at);
  for (const i of latestByKey(input.integrations, (x) => `${x.collaborator_id}|${x.client_id}`).values())
    push("integracao", `${i.collaborator_id}|${i.client_id}`, i.collaborator_id, `Integração ${input.clientName.get(i.client_id) ?? ""}`.trim(), i.expires_at);
  return out;
}

export type RadarDay = { date: string; count: number; tone: "red" | "orange" | "green"; docs: ExpiringDoc[] };

/** Radar: um ponto por dia de hoje até hoje + dias − 1, com os documentos que vencem naquele dia; vencidos à parte. */
export function expiryRadar(docs: ExpiringDoc[], today: string, days = 60) {
  const end = addDaysIso(today, days - 1);
  const byDate = new Map<string, ExpiringDoc[]>();
  let expired = 0;
  for (const d of docs) {
    if (d.expires < today) { expired++; continue; }
    if (d.expires > end) continue;
    byDate.set(d.expires, [...(byDate.get(d.expires) ?? []), d]);
  }
  const out: RadarDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(today, i);
    const list = (byDate.get(date) ?? []).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    out.push({ date, count: list.length, tone: urgencyTone(i), docs: list });
  }
  const total = out.reduce((s, d) => s + d.count, 0);
  const week = out.slice(0, 7).reduce((s, d) => s + d.count, 0);
  return { days: out, total, week, expired };
}

export type ClassGroup = { trainingId: string; label: string; date: string; count: number };

/** Turmas se formando: agendamentos de treinamento (status agendado) na mesma data futura, uma pessoa uma vez. */
export function formingClasses(
  appts: { training_id: string | null; scheduled_date: string; collaborator_id: string; status?: string; type?: string }[],
  today: string,
  trainingName: ReadonlyMap<string, string>,
  minPeople = 2,
): ClassGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const a of appts) {
    if (!a.training_id || a.scheduled_date < today) continue;
    if (a.status && a.status !== "agendado") continue;
    if (a.type && a.type !== "treinamento") continue;
    const k = `${a.training_id}|${a.scheduled_date}`;
    groups.set(k, (groups.get(k) ?? new Set()).add(a.collaborator_id));
  }
  return [...groups]
    .map(([k, s]) => { const [trainingId, date] = k.split("|") as [string, string]; return { trainingId, date, label: trainingName.get(trainingId) ?? "Treinamento", count: s.size }; })
    .filter((g) => g.count >= minPeople)
    .sort((a, b) => a.date.localeCompare(b.date) || b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Motivos que impedem a pessoa de trabalhar no serviço na data (mesma regra da Programação):
 * treinamentos exigidos pelo cliente (checkRequirements, bloqueantes), integração vencida/ausente quando o cliente exige
 * e ASO vencido/ausente (todo cliente, menos o Pátio; aceite na Conferência para o cliente libera).
 */
export function releaseIssues(ctx: ScheduleContext, collaboratorId: string, workId: string, date: string): string[] {
  const out = checkRequirements(ctx, workId, collaboratorId, date).filter((i) => i.blocking).map((i) => i.label);
  if (workRequiresIntegration(ctx, workId)) {
    const integ = checkIntegration(ctx, workId, collaboratorId, date);
    if (integ.status === "expired") out.push(`Integração vencida em ${formatDateBR(integ.expiresAt)}`);
    if (integ.status === "missing") out.push("Sem integração no cliente");
    if (asoBlocksWork(ctx, workId)) {
      const aso = checkAso(ctx, collaboratorId, date, workId);
      if (aso.status === "expired") out.push(`ASO vencido em ${formatDateBR(aso.expiresAt)}`);
      if (aso.status === "missing") out.push("Não possui ASO válido");
    }
  }
  return out;
}

export type BlockedPerson = { collaboratorId: string; name: string; clientId: string | null; clientName: string; workName: string; reasons: string[] };

/** Escalados no dia (alocações) que não poderiam trabalhar no serviço: um item por pessoa × serviço. */
export function blockedPeople(ctx: ScheduleContext, allocations: { collaborator_id: string; work_id: string }[], date: string): BlockedPerson[] {
  const seen = new Set<string>();
  const out: BlockedPerson[] = [];
  for (const a of allocations) {
    const k = `${a.collaborator_id}|${a.work_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const person = ctx.activeById.get(a.collaborator_id);
    const work = ctx.worksById.get(a.work_id);
    if (!person || !work) continue;
    const reasons = releaseIssues(ctx, a.collaborator_id, a.work_id, date);
    if (reasons.length)
      out.push({ collaboratorId: a.collaborator_id, name: person.full_name, clientId: work.client_id, clientName: work.clients?.name ?? "—", workName: work.name, reasons });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
}

export type ClientReadiness = { clientId: string; clientName: string; team: number; released: number; pct: number; pending: string[] };

/**
 * Prontidão por cliente: da equipe que trabalhou no cliente no período (alocações), quantos estão liberados hoje
 * (ASO, treinamentos exigidos e integração). Usa um serviço ativo do cliente para a regra (é por cliente).
 */
export function clientReadiness(ctx: ScheduleContext, allocations: { collaborator_id: string; work_id: string }[], date: string): ClientReadiness[] {
  const team = new Map<string, Set<string>>();
  const workOf = new Map<string, string>();
  for (const a of allocations) {
    const w = ctx.worksById.get(a.work_id);
    if (!w?.client_id || !ctx.activeById.has(a.collaborator_id)) continue;
    team.set(w.client_id, (team.get(w.client_id) ?? new Set()).add(a.collaborator_id));
    if (!workOf.has(w.client_id) || w.active) workOf.set(w.client_id, w.id);
  }
  const out: ClientReadiness[] = [];
  for (const [clientId, ids] of team) {
    const workId = workOf.get(clientId)!;
    const pending: string[] = [];
    for (const id of ids) if (releaseIssues(ctx, id, workId, date).length) pending.push(ctx.activeById.get(id)!.full_name);
    const released = ids.size - pending.length;
    out.push({ clientId, clientName: ctx.worksById.get(workId)?.clients?.name ?? "—", team: ids.size, released, pct: ids.size ? released / ids.size : 1, pending: pending.sort((a, b) => a.localeCompare(b, "pt-BR")) });
  }
  return out.sort((a, b) => a.pct - b.pct || b.team - a.team || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

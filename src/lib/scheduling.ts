import { supabase } from "@/integrations/supabase/client";

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Vencimento = realização + validade (meses) − 1 dia.
 * Ex.: 15/01/2026 + 12 meses → 14/01/2027. Válido até o próprio dia do vencimento.
 */
export const expiryFrom = (iso: string, months: number) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + months, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};

/** Dia anterior de programação: numa segunda-feira, volta para a sexta. */
export const previousScheduleDay = (iso: string) => {
  const weekday = new Date(iso + "T12:00:00").getDay();
  return addDays(iso, weekday === 1 ? -3 : -1);
};

export const formatBR = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export type Collaborator = {
  id: string;
  full_name: string;
  cpf?: string | null;
  registration_number: string;
  position_id: string | null;
  status: string;
  is_driver: boolean;
  driver_license_category: string | null;
  driver_license_expiry: string | null;
  contract_type: string | null;
};

export type Requirement = {
  id: string;
  work_id: string;
  requirement_type: string;
  requirement_id: string | null;
  requirement_label: string | null;
  mandatory: boolean;
  blocking: boolean;
  active: boolean;
};

export type Absence = { collaborator_id: string; reason: string };

export type Integration = {
  collaborator_id: string;
  client_id: string;
  integration_date: string;
  expires_at: string | null;
  documentation?: boolean | null;
};

export type Aso = {
  collaborator_id: string;
  exam_date: string;
  expires_at: string;
};

/** Dias de antecedência para considerar a integração "próxima do vencimento". */
export const INTEGRATION_WARN_DAYS = 30;

export type AsoStatus = "valid" | "expiring" | "expired" | "missing";

export const ASO_LABEL: Record<AsoStatus, string> = {
  valid: "ASO válido",
  expiring: "ASO próximo do vencimento",
  expired: "ASO vencido",
  missing: "Sem ASO cadastrado",
};

/** Status do ASO mais recente do colaborador (não depende da obra). */
export function asoStatusOf(expires: string | null | undefined, date: string): AsoStatus {
  if (!expires) return "missing";
  if (expires < date) return "expired";
  if (expires <= addDays(date, INTEGRATION_WARN_DAYS)) return "expiring";
  return "valid";
}

export type IntegrationStatus =
  | "valid"
  | "expiring"
  | "expired"
  | "missing"
  | "no_client"
  | "not_required";

export const INTEGRATION_LABEL: Record<IntegrationStatus, string> = {
  valid: "Integração válida",
  expiring: "Integração próxima do vencimento",
  expired: "Integração vencida",
  missing: "Sem integração com o cliente",
  no_client: "Serviço sem cliente vinculado",
  not_required: "Integração não exigida",
};

/** Data needed to build a schedule for a given date. */
export async function fetchScheduleContext(date: string) {
  const [
    works,
    collaborators,
    positions,
    vehicles,
    baseTeams,
    requirements,
    trainings,
    collabTrainings,
    vacations,
    leaves,
    daysOff,
    holidays,
    integrations,
    asos,
  ] = await Promise.all([
    supabase.from("works").select("id, name, client_id, entry_time, exit_time, exit_time_weekend, status, active, clients(name, city, distance_km, requires_integration)").order("name"),
    supabase
      .from("collaborators")
      .select("id, full_name, cpf, registration_number, position_id, status, is_driver, driver_license_category, driver_license_expiry, contract_type")
      .order("full_name"),
    supabase.from("positions").select("id, name").order("name"),
    supabase.from("vehicles").select("id, plate, model, passenger_capacity, status").order("plate"),
    supabase.from("work_base_teams").select("*").eq("active", true).lte("start_date", date),
    Promise.resolve({ data: [] }),
    supabase.from("trainings").select("id, name, validity_months"),
    supabase.from("collaborator_trainings").select("collaborator_id, training_id, expires_at"),
    supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date),
    supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date),
    supabase
      .from("days_off")
      .select("collaborator_id")
      .lte("date", date)
      .or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`),
    supabase.from("holidays").select("name").eq("date", date),
    supabase.from("client_integrations").select("collaborator_id, client_id, integration_date, expires_at, documentation"),
    supabase.from("asos").select("collaborator_id, exam_date, expires_at"),
  ]);

  // Aceites parciais da Conferência: documento aceito por um cliente libera só aquele cliente.
  const confChecks = await supabase
    .from("conference_checks")
    .select("client_id, approved, conference_items!inner(collaborator_id, type, training_id, status)");
  const conferenceAccepted = new Set<string>();
  const conferencePending = new Set<string>();
  for (const r of (confChecks.data ?? []) as unknown as {
    client_id: string;
    approved: boolean;
    conference_items: { collaborator_id: string; type: string; training_id: string | null; status: string } | null;
  }[]) {
    const it = r.conference_items;
    if (!it || it.status === "concluido") continue;
    const kind = String(it.type).toLowerCase().includes("aso") ? "aso" : `t:${it.training_id ?? ""}`;
    const key = `${it.collaborator_id}|${kind}|${r.client_id}`;
    (r.approved ? conferenceAccepted : conferencePending).add(key);
  }

  const absences = new Map<string, string>();
  (vacations.data ?? []).forEach((v) => absences.set(v.collaborator_id, "Férias"));
  (leaves.data ?? []).forEach((v) => absences.set(v.collaborator_id, "Atestado"));
  (daysOff.data ?? []).forEach((v) => absences.set(v.collaborator_id, "Folga"));

  const allPeople = (collaborators.data ?? []) as Collaborator[];

  return {
    works: works.data ?? [],
    collaborators: allPeople.filter((p) => p.status === "active"),
    /** Inativos: só entram na tela quando já estavam escalados no dia. */
    inactiveCollaborators: allPeople.filter((p) => p.status !== "active"),
    positions: positions.data ?? [],
    vehicles: vehicles.data ?? [],
    baseTeams: (baseTeams.data ?? []).filter((b) => !b.end_date || b.end_date >= date),
    requirements: [] as Requirement[], // aba Requisitos removida
    trainings: trainings.data ?? [],
    collabTrainings: collabTrainings.data ?? [],
    absences,
    holiday: holidays.data?.[0]?.name ?? null,
    integrations: (integrations.data ?? []) as Integration[],
    asos: (asos.data ?? []) as Aso[],
    conferenceAccepted,
    conferencePending,
  };
}

/** Documento aceito na Conferência para o cliente do serviço (ainda não concluída). */
export function acceptedForWork(
  ctx: ScheduleContext,
  collaboratorId: string,
  kind: "aso" | `t:${string}`,
  workId?: string | null,
): boolean {
  if (!workId) return false;
  const clientId = ctx.works.find((w) => w.id === workId)?.client_id;
  if (!clientId) return false;
  return (ctx.conferenceAccepted ?? new Set()).has(`${collaboratorId}|${kind}|${clientId}`);
}

/** Documento aguardando aceite deste cliente na Conferência. */
export function pendingForWork(ctx: ScheduleContext, collaboratorId: string, workId?: string | null): boolean {
  const clientId = workId ? ctx.works.find((w) => w.id === workId)?.client_id : null;
  if (!clientId) return false;
  for (const k of ctx.conferencePending ?? []) if (k.startsWith(`${collaboratorId}|`) && k.endsWith(`|${clientId}`)) return true;
  return false;
}

/** ASO mais recente do colaborador e seu status na data informada (considera aceite por cliente). */
export function checkAso(
  ctx: ScheduleContext,
  collaboratorId: string,
  date: string,
  workId?: string | null,
): { status: AsoStatus; expiresAt: string | null } {
  const recs = (ctx.asos ?? []).filter((a) => a.collaborator_id === collaboratorId);
  const latest = recs.length ? recs.reduce((a, b) => (b.expires_at > a.expires_at ? b : a)) : null;
  const status = latest ? asoStatusOf(latest.expires_at, date) : "missing";
  if ((status === "expired" || status === "missing") && acceptedForWork(ctx, collaboratorId, "aso", workId))
    return { status: "valid", expiresAt: latest?.expires_at ?? null };
  return { status, expiresAt: latest?.expires_at ?? null };
}


/** A obra exige integração (e, portanto, ASO válido)? */
export function workRequiresIntegration(ctx: ScheduleContext, workId: string): boolean {
  const work = ctx.works.find((w) => w.id === workId);
  if (!work?.client_id) return false;
  return work.clients?.requires_integration !== false;
}

/** Status da integração de um colaborador com o cliente de uma obra. */
export function checkIntegration(
  ctx: ScheduleContext,
  workId: string,
  collaboratorId: string,
  date: string,
): { status: IntegrationStatus; expiresAt: string | null } {
  const work = ctx.works.find((w) => w.id === workId);
  const clientId = work?.client_id ?? null;
  if (!clientId) return { status: "no_client", expiresAt: null };
  if (work?.clients?.requires_integration === false) return { status: "not_required", expiresAt: null };
  const rec = ctx.integrations.find((i) => i.collaborator_id === collaboratorId && i.client_id === clientId);
  if (!rec || rec.documentation) {
    // Integração agendada + documento aceito por este cliente na Conferência: libera a escalação.
    for (const k of ctx.conferenceAccepted ?? [])
      if (k.startsWith(`${collaboratorId}|`) && k.endsWith(`|${clientId}`)) return { status: "valid", expiresAt: null };
    return { status: "missing", expiresAt: null };
  }
  if (!rec.expires_at) return { status: "valid", expiresAt: null };
  if (rec.expires_at < date) return { status: "expired", expiresAt: rec.expires_at };
  if (rec.expires_at <= addDays(date, INTEGRATION_WARN_DAYS))
    return { status: "expiring", expiresAt: rec.expires_at };
  return { status: "valid", expiresAt: rec.expires_at };
}

export type ScheduleContext = Awaited<ReturnType<typeof fetchScheduleContext>>;

/** Returns the list of unmet requirements for a collaborator on a work. */
export function checkRequirements(
  ctx: ScheduleContext,
  workId: string,
  collaboratorId: string,
  date: string,
): { label: string; blocking: boolean }[] {
  const person = ctx.collaborators.find((c) => c.id === collaboratorId);
  if (!person) return [];
  const issues: { label: string; blocking: boolean }[] = [];

  for (const req of ctx.requirements.filter((r) => r.work_id === workId)) {
    const trainingName = ctx.trainings.find((t) => t.id === req.requirement_id)?.name;
    const positionName = ctx.positions.find((p) => p.id === req.requirement_id)?.name;
    let ok = true;
    let label = req.requirement_label ?? "Requisito";

    switch (req.requirement_type) {
      case "training": {
        label = `Treinamento: ${trainingName ?? req.requirement_label ?? "—"}`;
        const rec = ctx.collabTrainings.find(
          (t) => t.collaborator_id === collaboratorId && t.training_id === req.requirement_id,
        );
        ok = (!!rec && (!rec.expires_at || rec.expires_at >= date)) ||
          acceptedForWork(ctx, collaboratorId, `t:${req.requirement_id ?? ""}`, workId);
        break;
      }
      case "position": {
        label = `Função: ${positionName ?? req.requirement_label ?? "—"}`;
        ok = person.position_id === req.requirement_id;
        break;
      }
      case "driver_license": {
        label = "CNH válida";
        ok = person.is_driver && !!person.driver_license_expiry && person.driver_license_expiry >= date;
        break;
      }
      default: {
        // certification / medical_exam / custom: controle manual
        label = `${req.requirement_label ?? "Requisito"} (conferência manual)`;
        ok = !req.mandatory;
      }
    }

    if (!ok) issues.push({ label, blocking: req.blocking });
  }
  return issues;
}

export const formatDateBR = (iso?: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

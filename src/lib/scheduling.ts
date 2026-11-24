import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { addDays, DOC_WARN_DAYS, docStatus, expiryFrom } from "@/lib/doc-status";

export { addDays, expiryFrom };

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
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
  /** Aviso prévio (RH): início e fim; depois do fim não pode ser escalado em obras. */
  notice_start?: string | null;
  notice_end?: string | null;
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
export const INTEGRATION_WARN_DAYS = DOC_WARN_DAYS;

export type AsoStatus = "valid" | "expiring" | "expired" | "missing";

export const ASO_LABEL: Record<AsoStatus, string> = {
  valid: "ASO válido",
  expiring: "ASO próximo do vencimento",
  expired: "ASO vencido",
  missing: "Sem ASO cadastrado",
};

/** Status do ASO mais recente do colaborador (não depende da obra). */
export function asoStatusOf(expires: string | null | undefined, date: string): AsoStatus {
  return expires ? docStatus(expires, date, INTEGRATION_WARN_DAYS) : "missing";
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

/** Clientes em que ASO vencido/ausente não bloqueia a escalação: o Pátio é a espera de quem ainda não foi liberado. */
const ASO_FREE_CLIENTS = new Set(["PATIO"]);
const plainName = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

type CtxWork = {
  id: string; name: string; client_id: string | null; entry_time: string | null; exit_time: string | null; exit_time_weekend: string | null;
  status: string | null; active: boolean | null;
  clients: { name: string; city: string | null; distance_km: number | null; requires_integration: boolean | null; needs_transport_voucher: boolean | null } | null;
};

/** Data needed to build a schedule for a given date. */
export async function fetchScheduleContext(date: string) {
  // Listas que passam de 1000 linhas são lidas em páginas (antes cortava em silêncio no limite do Supabase).
  const [
    works,
    collaborators,
    positions,
    vehicles,
    baseTeams,
    trainings,
    collabTrainings,
    vacations,
    leaves,
    daysOff,
    holidays,
    integrations,
    asos,
    required,
    confChecks,
  ] = await Promise.all([
    fetchAll<CtxWork>((f, t) => supabase.from("works").select("id, name, client_id, entry_time, exit_time, exit_time_weekend, status, active, clients(name, city, distance_km, requires_integration, needs_transport_voucher)").order("name").order("id").range(f, t) as never),
    fetchAll<Collaborator>((f, t) => supabase
      .from("collaborators")
      .select("id, full_name, cpf, registration_number, position_id, status, is_driver, driver_license_category, driver_license_expiry, contract_type, notice_start, notice_end")
      .order("full_name").order("id").range(f, t)),
    supabase.from("positions").select("id, name").order("name"),
    supabase.from("vehicles").select("id, plate, model, passenger_capacity, status").order("plate"),
    supabase.from("work_base_teams").select("*").eq("active", true).lte("start_date", date),
    supabase.from("trainings").select("id, name, validity_months"),
    fetchAll<{ collaborator_id: string; training_id: string; expires_at: string | null }>((f, t) =>
      supabase.from("collaborator_trainings").select("collaborator_id, training_id, expires_at").order("id").range(f, t)),
    supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date),
    supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date),
    supabase
      .from("days_off")
      .select("collaborator_id")
      .lte("date", date)
      .or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`),
    supabase.from("holidays").select("name").eq("date", date),
    fetchAll<Integration>((f, t) => supabase.from("client_integrations").select("collaborator_id, client_id, integration_date, expires_at, documentation").order("id").range(f, t)),
    fetchAll<Aso>((f, t) => supabase.from("asos").select("collaborator_id, exam_date, expires_at").order("id").range(f, t)),
    // Treinamentos exigidos pelo cliente (cadastro do cliente). Falha (ex.: tabela ainda não criada) = nenhum exigido.
    fetchAll<{ client_id: string; training_id: string }>((f, t) =>
      supabase.from("client_required_trainings").select("client_id, training_id").order("client_id").order("training_id").range(f, t)).catch(() => []),
    // Aceites parciais da Conferência: documento aceito por um cliente libera só aquele cliente.
    fetchAll<{
      client_id: string;
      approved: boolean;
      conference_items: { collaborator_id: string; type: string; training_id: string | null; status: string } | null;
    }>((f, t) => supabase
      .from("conference_checks")
      .select("client_id, approved, conference_items!inner(collaborator_id, type, training_id, status)")
      .order("id").range(f, t) as never),
  ]);

  const conferenceAccepted = new Set<string>();
  const conferencePending = new Set<string>();
  for (const r of confChecks) {
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

  const allPeople = collaborators;
  const trainingList = trainings.data ?? [];
  const trainingName = new Map(trainingList.map((t) => [t.id, t.name]));
  const requiredByClient = new Map<string, string[]>();
  for (const r of required) requiredByClient.set(r.client_id, [...(requiredByClient.get(r.client_id) ?? []), r.training_id]);

  return {
    works,
    collaborators: allPeople.filter((p) => p.status === "active"),
    /** Inativos: só entram na tela quando já estavam escalados no dia. */
    inactiveCollaborators: allPeople.filter((p) => p.status !== "active"),
    positions: positions.data ?? [],
    vehicles: vehicles.data ?? [],
    baseTeams: (baseTeams.data ?? []).filter((b) => !b.end_date || b.end_date >= date),
    /** Requisitos de cada serviço = treinamentos exigidos pelo cliente do serviço (bloqueiam a escalação). */
    requirements: requirementsFrom(works, requiredByClient, trainingName),
    /** Treinamentos exigidos por cliente (client_id → training_ids). */
    requiredTrainings: requiredByClient,
    trainings: trainingList,
    collabTrainings,
    absences,
    holiday: holidays.data?.[0]?.name ?? null,
    integrations,
    asos,
    conferenceAccepted,
    conferencePending,
  };
}

/** Um requisito de treinamento (bloqueante) por serviço × treinamento exigido pelo cliente do serviço. */
export function requirementsFrom(
  works: { id: string; client_id: string | null }[],
  requiredByClient: Map<string, string[]>,
  trainingName: Map<string, string>,
): Requirement[] {
  const out: Requirement[] = [];
  for (const w of works) {
    if (!w.client_id) continue;
    for (const tid of requiredByClient.get(w.client_id) ?? [])
      out.push({
        id: `${w.client_id}|${tid}|${w.id}`, work_id: w.id, requirement_type: "training", requirement_id: tid,
        requirement_label: trainingName.get(tid) ?? "Treinamento", mandatory: true, blocking: true, active: true,
      });
  }
  return out;
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
  // Em Documentação, segue liberada enquanto não vence (pode ser marcada já perto do vencimento).
  if (!rec || (rec.documentation && (!rec.expires_at || rec.expires_at < date))) {
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
        const st = checkTraining(ctx, collaboratorId, req.requirement_id ?? "", date, workId);
        const name = trainingName ?? req.requirement_label ?? "Treinamento";
        ok = st.status === "valid" || st.status === "expiring";
        label = st.status === "expired" ? `${name} vencida em ${formatDateBR(st.expiresAt)}` : `Sem ${name}`;
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

  // ASO vencido/ausente bloqueia em todo cliente. Nos que exigem integração o evaluate da Programação já bloqueia
  // (asoBad); aqui entram os demais (ADM, Indústria, Comercial...), menos o Pátio (espera de liberação).
  if (asoBlocksWork(ctx, workId) && !workRequiresIntegration(ctx, workId)) {
    const aso = checkAso(ctx, collaboratorId, date, workId);
    if (aso.status === "expired") issues.push({ label: `ASO vencido em ${formatDateBR(aso.expiresAt)}`, blocking: true });
    if (aso.status === "missing") issues.push({ label: "Não possui ASO válido", blocking: true });
  }
  return issues;
}

/** ASO vencido/ausente bloqueia a escalação neste serviço? Todo serviço com cliente, menos o Pátio. */
export function asoBlocksWork(ctx: ScheduleContext, workId: string): boolean {
  const work = ctx.works.find((w) => w.id === workId);
  if (!work?.client_id) return false;
  return !ASO_FREE_CLIENTS.has(plainName(work.clients?.name));
}

export type TrainingCheck = { status: "valid" | "expiring" | "expired" | "missing"; expiresAt: string | null };

/**
 * Treinamento do colaborador na data (registro de vencimento mais distante; sem vencimento = não vence).
 * Vencido/ausente com documento aceito na Conferência por este cliente conta como válido.
 */
export function checkTraining(
  ctx: ScheduleContext,
  collaboratorId: string,
  trainingId: string,
  date: string,
  workId?: string | null,
): TrainingCheck {
  let best: { expires_at: string | null } | null = null;
  for (const t of ctx.collabTrainings)
    if (t.collaborator_id === collaboratorId && t.training_id === trainingId && (!best || (t.expires_at ?? "9999-12-31") > (best.expires_at ?? "9999-12-31"))) best = t;
  const status: TrainingCheck["status"] = !best ? "missing"
    : !best.expires_at ? "valid"
      : best.expires_at < date ? "expired"
        : best.expires_at <= addDays(date, INTEGRATION_WARN_DAYS) ? "expiring" : "valid";
  if ((status === "expired" || status === "missing") && acceptedForWork(ctx, collaboratorId, `t:${trainingId}`, workId))
    return { status: "valid", expiresAt: best?.expires_at ?? null };
  return { status, expiresAt: best?.expires_at ?? null };
}

export const formatDateBR = (iso?: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

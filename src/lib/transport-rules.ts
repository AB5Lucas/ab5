import { supabase } from "@/integrations/supabase/client";

/**
 * Transporte montado (aba Serviços → Montar transporte): quando o cliente tem o
 * transporte dividido no dia, VT só para quem está em "Transporte próprio" e
 * prêmio motorista só para o motorista do veículo. Sem montagem, valem a aba
 * Transporte (prêmio) e as bolinhas verdes da Programação (VT).
 */
export type BuiltTransport = { built: Set<string>; own: Set<string> };

/** Um registro desligado é explícito; só a ausência de registro herda o cadastro. */
export function workVtDefault(value: boolean | null | undefined, clientDefault: boolean | null | undefined) {
  return value ?? clientDefault ?? false;
}

export type PassengerRow = { client_id: string; schedule_date: string; collaborator_id: string; vehicle_schedule_id: string | null };

/**
 * Monta o índice do transporte montado. `valid(cliente, dia, pessoa)` diz se o passageiro ainda atende o cliente no dia
 * (escalado num serviço do cliente ou em integração nele): quem saiu do cliente na Programação não conta, senão o
 * cliente/dia continuaria "montado" só por causa de uma linha esquecida.
 */
export function buildTransport(rows: PassengerRow[], valid?: (clientId: string, date: string, collaboratorId: string) => boolean): BuiltTransport {
  const built = new Set<string>();
  const own = new Set<string>();
  for (const p of rows) {
    const date = String(p.schedule_date).slice(0, 10);
    if (valid && !valid(p.client_id, date, p.collaborator_id)) continue;
    built.add(`${p.client_id}|${date}`);
    if (!p.vehicle_schedule_id) own.add(`${p.client_id}|${date}|${p.collaborator_id}`);
  }
  return { built, own };
}

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Transporte montado entre start (inclusive) e end (exclusivo), sem os passageiros que já saíram do cliente. */
export async function loadBuiltTransport(start: string, end: string): Promise<BuiltTransport> {
  const rows = await pages<PassengerRow>((a, b) => supabase.from("transport_passengers")
    .select("client_id, schedule_date, collaborator_id, vehicle_schedule_id")
    .gte("schedule_date", start).lt("schedule_date", end).order("id").range(a, b));
  if (!rows.length) return buildTransport([]);
  // Quem atende o cliente no dia: escalado num serviço dele ou em integração nele (quadro ou agendamento).
  const ok = new Set<string>();
  const { data: sch } = await supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", start).lt("schedule_date", end);
  const dateOf = new Map((sch ?? []).map((s) => [s.id, s.schedule_date]));
  const ids = [...dateOf.keys()];
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
  const clientByBox = new Map((clients ?? []).map((c) => [`integracao:${c.name}`, c.id]));
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const [allocs, boxes] = await Promise.all([
      pages<any>((a, b) => supabase.from("daily_allocations").select("schedule_id, collaborator_id, works(client_id)").in("schedule_id", part).order("id").range(a, b)),
      pages<any>((a, b) => supabase.from("daily_status_entries").select("schedule_id, collaborator_id, box_key").in("schedule_id", part).like("box_key", "integracao:%").order("id").range(a, b)),
    ]);
    for (const a of allocs) if (a.works?.client_id) ok.add(`${a.works.client_id}|${dateOf.get(a.schedule_id)}|${a.collaborator_id}`);
    for (const e of boxes) { const c = clientByBox.get(e.box_key); if (c) ok.add(`${c}|${dateOf.get(e.schedule_id)}|${e.collaborator_id}`); }
  }
  const appts = await pages<any>((a, b) => supabase.from("appointments").select("client_id, collaborator_id, scheduled_date, completed_date, status")
    .eq("type", "integracao").in("client_id", clientIds).gte("scheduled_date", start).lt("scheduled_date", end).order("id").range(a, b));
  for (const ap of appts) {
    if (ap.status === "cancelled" || ap.status === "canceled") continue;
    ok.add(`${ap.client_id}|${String(ap.completed_date ?? ap.scheduled_date).slice(0, 10)}|${ap.collaborator_id}`);
  }
  return buildTransport(rows, (c, d, p) => ok.has(`${c}|${d}|${p}`));
}

/** VT do dia: transporte montado manda; senão, a regra da Programação (fallback). */
export function vtFor(t: BuiltTransport, clientId: string | null | undefined, date: string, collaboratorId: string, fallback: boolean) {
  if (clientId && t.built.has(`${clientId}|${date}`)) return t.own.has(`${clientId}|${date}|${collaboratorId}`);
  return fallback;
}

/** Prêmio motorista: transporte montado = quem é motorista (exceto PJ); senão, o botão da aba Transporte. */
export function driverBonusFor(t: BuiltTransport, v: { client_id: string | null; schedule_date: string; driver_id: string | null; driver_bonus: boolean }, isPj: boolean) {
  if (!v.driver_id) return false;
  if (v.client_id && t.built.has(`${v.client_id}|${v.schedule_date}`)) return !isPj;
  return v.driver_bonus;
}

export const isPousoAlegre = (city: string | null | undefined) => String(city ?? "").toLowerCase().includes("pouso alegre");

/**
 * Entrada da regra de VT de uma pessoa escalada numa obra num dia (Fechamento, Resultados/Financeiro e bolinha da Programação).
 * - vtEnabled: collaborators.vt_enabled (false = sem VT por padrão; a marcação da pessoa no dia ainda vale).
 * - lodgingBlocks: alojamento que tira os benefícios no cliente (Americana na Suzano).
 * - vtNever: Montador alojado em Mogi Guaçu — nunca VT, nem com VT cheio ou marcação à mão.
 * - alwaysFull: collaborators.vt_always_full (VT cheio: todo dia trabalhado paga).
 * - workMark: schedule_work_vt da obra no dia (schedule_id|work_id); sem linha = padrão do cliente.
 * - clientDefault: clients.needs_transport_voucher.
 * - homeCity: cidade que vale no dia (alojamento ou cadastro) para a regra de Pouso Alegre.
 * - override: daily_allocations.vt_override (marcação da pessoa no dia).
 * - transport + clientId/date/collaboratorId: transporte montado na aba Serviços (manda quando existe).
 */
export type VtDayInput = {
  vtEnabled?: boolean | null | undefined;
  lodgingBlocks?: boolean | undefined;
  vtNever?: boolean | undefined;
  alwaysFull?: boolean | null | undefined;
  workMark?: boolean | null | undefined;
  clientDefault?: boolean | null | undefined;
  homeCity?: string | null | undefined;
  override?: boolean | null | undefined;
  transport?: BuiltTransport | undefined;
  clientId?: string | null | undefined;
  date?: string | undefined;
  collaboratorId?: string | undefined;
};

/** VT padrão da pessoa na obra no dia, antes da marcação da pessoa (bolinha sem vt_override). */
export function vtBaseForDay(i: VtDayInput): boolean {
  if (i.vtEnabled === false || i.lodgingBlocks) return false;
  return workVtDefault(i.workMark, i.clientDefault) || isPousoAlegre(i.homeCity);
}

/**
 * Regra única do VT do dia, na ordem do Fechamento:
 * Montador alojado em Mogi Guaçu → nunca; VT cheio → sempre; senão transporte montado (se houver) ou
 * marcação da pessoa (vt_override) ?? padrão (vt_enabled/alojamento → não; marcação da obra ?? padrão do cliente; Pouso Alegre).
 */
export function vtForDay(i: VtDayInput): boolean {
  if (i.vtNever) return false;
  if (i.alwaysFull) return true;
  const fallback = !!(i.override ?? vtBaseForDay(i));
  if (i.transport && i.date && i.collaboratorId) return vtFor(i.transport, i.clientId, i.date, i.collaboratorId, fallback);
  return fallback;
}

/**
 * Prêmio viagem ligado para a pessoa na obra no dia (antes da faixa de distância):
 * cadastro com prêmio desligado → nunca; marcação da pessoa (travel_bonus_override) manda; alojamento que bloqueia → não;
 * senão a marcação da obra no dia (schedule_work_travel) ?? padrão pela distância do cliente (workDefault).
 */
export function travelOnFor(i: { enabled?: boolean | null | undefined; override?: boolean | null | undefined; lodgingBlocks?: boolean | undefined; workMark?: boolean | null | undefined; workDefault: boolean }): boolean {
  if (i.enabled === false) return false;
  if (i.override != null) return i.override;
  if (i.lodgingBlocks) return false;
  return i.workMark ?? i.workDefault;
}

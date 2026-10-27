import { supabase } from "@/integrations/supabase/client";

/**
 * Transporte montado (aba Serviços → Montar transporte): quando o cliente tem o
 * transporte dividido no dia, VT só para quem está em "Transporte próprio" e
 * prêmio motorista só para o motorista do veículo. Sem montagem, valem a aba
 * Transporte (prêmio) e as bolinhas verdes da Programação (VT).
 */
export type BuiltTransport = { built: Set<string>; own: Set<string> };

export async function loadBuiltTransport(start: string, end: string): Promise<BuiltTransport> {
  const built = new Set<string>();
  const own = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("transport_passengers")
      .select("client_id, schedule_date, collaborator_id, vehicle_schedule_id")
      .gte("schedule_date", start).lt("schedule_date", end).order("id").range(from, from + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      built.add(`${p.client_id}|${p.schedule_date}`);
      if (!p.vehicle_schedule_id) own.add(`${p.client_id}|${p.schedule_date}|${p.collaborator_id}`);
    }
    if (!data || data.length < 1000) break;
  }
  return { built, own };
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

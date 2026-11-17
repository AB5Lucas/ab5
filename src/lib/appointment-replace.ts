import { supabase } from "@/integrations/supabase/client";

/**
 * Agendamentos futuros do mesmo tipo (ASO; treinamento da mesma NR; integração no mesmo cliente) que o novo
 * agendamento vai substituir. A troca é feita no banco (trigger trg_appointments_replace_future cancela os antigos);
 * aqui só se busca para avisar quem agendou.
 */
export async function futureSameKind(p: { collaborator_id: string; type: string; training_id?: string | null; client_id?: string | null }): Promise<string[]> {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  let q = supabase.from("appointments").select("scheduled_date").eq("collaborator_id", p.collaborator_id).eq("type", p.type)
    .eq("status", "agendado").gte("scheduled_date", today);
  if (p.type === "treinamento" && p.training_id) q = q.eq("training_id", p.training_id);
  if (p.type === "integracao" && p.client_id) q = q.eq("client_id", p.client_id);
  const { data } = await q;
  return (data ?? []).map((a) => a.scheduled_date.split("-").reverse().join("/"));
}
export const replacedText = (dates: string[]) => (dates.length ? ` · substituiu o agendamento de ${dates.join(", ")}` : "");

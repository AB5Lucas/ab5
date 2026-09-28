import { supabase } from "@/integrations/supabase/client";

/** Motivos que o encarregado pode informar (nunca são classificação definitiva). */
export const REPORTED_REASONS = [
  { key: "falta", label: "Falta" },
  { key: "atestado", label: "Atestado" },
  { key: "medico", label: "Médico" },
  { key: "interjornada", label: "Interjornada" },
  { key: "outro", label: "Outro motivo" },
] as const;

/** Classificações definitivas = caixas existentes da Programação. */
export const FINAL_CLASSES = [
  { key: "falta", label: "Falta" },
  { key: "atestado", label: "Atestado" },
  { key: "medico", label: "Médico" },
  { key: "interjornada", label: "Interjornada" },
] as const;

export const reasonLabel = (key: string | null | undefined, note?: string | null) => {
  if (!key) return "—";
  if (key === "outro") return note ? `Outro: ${note}` : "Outro motivo";
  return REPORTED_REASONS.find((r) => r.key === key)?.label ?? key;
};

export const SERVICE_CATEGORIES = [
  { key: "civil", label: "Civil" },
  { key: "alpinismo", label: "Alpinismo" },
  { key: "limpeza", label: "Limpeza" },
  { key: "outros", label: "Outros serviços" },
] as const;

export const SCAFFOLD_OPS = [
  { key: "montagem", label: "Montagem" },
  { key: "desmontagem", label: "Desmontagem" },
  { key: "movimentacao", label: "Movimentação" },
] as const;

export const RDO_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  finalized: "Finalizado",
  review: "Em revisão",
  approved: "Aprovado",
  rejected: "Rejeitado",
};

/** Horas = saída − entrada − intervalo. */
export function workedHours(entry?: string | null, exit?: string | null, breakMin = 60) {
  if (!entry || !exit) return 0;
  const [eh, em] = entry.split(":").map(Number);
  const [xh, xm] = exit.split(":").map(Number);
  const h = (xh! * 60 + xm! - (eh! * 60 + em!) - breakMin) / 60;
  return Math.max(0, Math.round(h * 100) / 100);
}

export type PendingOccurrence = {
  id: string;
  rdo_id: string;
  work_id: string;
  report_date: string;
  collaborator_id: string;
  allocation_id: string | null;
  reported_reason: string | null;
  reported_note: string | null;
};

/**
 * Classifica definitivamente a ocorrência: tira o colaborador da obra naquele dia
 * e o coloca na caixa correspondente da Programação (sem duplicar).
 */
export async function classifyOccurrence(occ: PendingOccurrence, finalKey: string, userId: string | null) {
  const { data: sched } = await supabase
    .from("daily_schedules")
    .select("id")
    .eq("schedule_date", occ.report_date)
    .maybeSingle();
  let scheduleId = sched?.id;
  if (!scheduleId) {
    const { data, error } = await supabase
      .from("daily_schedules")
      .insert({ schedule_date: occ.report_date })
      .select("id")
      .single();
    if (error) throw error;
    scheduleId = data.id;
  }
  const { error: delErr } = await supabase
    .from("daily_allocations")
    .delete()
    .eq("schedule_id", scheduleId)
    .eq("collaborator_id", occ.collaborator_id)
    .eq("work_id", occ.work_id);
  if (delErr) throw delErr;
  const { error: upErr } = await supabase
    .from("daily_status_entries")
    .upsert(
      { schedule_id: scheduleId, collaborator_id: occ.collaborator_id, box_key: finalKey, sort_order: Date.now() / 1e10 },
      { onConflict: "schedule_id,collaborator_id" },
    );
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("rdo_workforce")
    .update({
      final_classification: finalKey,
      occurrence_status: "classified",
      classified_by: userId,
      classified_at: new Date().toISOString(),
    })
    .eq("id", occ.id);
  if (error) throw error;
}

/** Nome da função sem o nível (N1..N4): "Ajudante N2" -> "Ajudante". */
export const positionLabel = (name?: string | null) =>
  name ? name.replace(/\s*[-–]?\s*\b(n[ií]vel|niv\.?|n)\s*\.?\s*[1-4]\b\s*$/i, "").trim() || name : null;

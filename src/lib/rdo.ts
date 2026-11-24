import { supabase } from "@/integrations/supabase/client";

/** Motivos que o encarregado pode informar (nunca são classificação definitiva). */
export const REPORTED_REASONS = [
  { key: "falta", label: "Falta" },
  { key: "atestado", label: "Atestado" },
  { key: "medico", label: "Médico" },
  { key: "interjornada", label: "Interjornada" },
  { key: "folga", label: "Folga" },
  { key: "licenca", label: "Licença" },
  { key: "outro", label: "Outro motivo" },
] as const;

/** Classificações definitivas = caixas existentes da Programação. */
export const FINAL_CLASSES = [
  { key: "falta", label: "Falta" },
  { key: "atestado", label: "Atestado" },
  { key: "medico", label: "Médico" },
  { key: "interjornada", label: "Interjornada" },
  { key: "folga", label: "Folga" },
  { key: "licenca", label: "Licença" },
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

/** Horas = saída − entrada − intervalo. Saída antes da entrada = virou a meia-noite (turno noturno). */
export function workedHours(entry?: string | null, exit?: string | null, breakMin = 60) {
  if (!entry || !exit) return 0;
  const [eh, em] = entry.split(":").map(Number);
  const [xh, xm] = exit.split(":").map(Number);
  let span = xh! * 60 + xm! - (eh! * 60 + em!);
  if (span < 0) span += 24 * 60;
  const h = (span - breakMin) / 60;
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
export async function classifyOccurrence(occ: PendingOccurrence, finalKey: string, _userId?: string | null) {
  // Uma transação no banco (classify_occurrence): tira da obra, põe no quadro e marca o RDO juntos.
  const { error } = await supabase.rpc("classify_occurrence", { _workforce_id: occ.id, _key: finalKey });
  if (error) throw error;
}

/** Nome da função sem o nível (N1..N4): "Ajudante N2" -> "Ajudante". */
export const positionLabel = (name?: string | null) =>
  name ? name.replace(/\s*[-–]?\s*\b(n[ií]vel|niv\.?|n)\s*\.?\s*[1-4]\b\s*$/i, "").trim() || name : null;

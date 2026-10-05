import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = {
  aso: "ASO",
  treinamento: "Treinamento",
  integracao: "Integração",
};

/** Lista tudo que o colaborador já tem marcado entre `from` e `to` (inclusive). */
export async function findDateConflicts(
  collaboratorId: string,
  from: string,
  to: string,
  exclude?: { table: string; id: string },
): Promise<string[]> {
  const skip = (table: string, id: string) => exclude?.table === table && exclude.id === id;
  const [ap, vac, off, med] = await Promise.all([
    supabase
      .from("appointments")
      .select("id,type,scheduled_date,status")
      .eq("collaborator_id", collaboratorId)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to),
    supabase
      .from("vacations")
      .select("id,start_date,end_date,status")
      .eq("collaborator_id", collaboratorId)
      .lte("start_date", to)
      .gte("end_date", from),
    supabase.from("days_off").select("id,date,end_date").eq("collaborator_id", collaboratorId).lte("date", to),
    supabase
      .from("medical_leaves")
      .select("id,start_date,end_date")
      .eq("collaborator_id", collaboratorId)
      .lte("start_date", to)
      .gte("end_date", from),
  ]);
  const out: string[] = [];
  for (const a of ap.data ?? []) {
    if (skip("appointments", a.id) || /cancel/i.test(a.status ?? "")) continue;
    out.push(`${TYPE_LABEL[a.type] ?? a.type} agendado em ${formatDateBR(a.scheduled_date)}`);
  }
  for (const v of vac.data ?? []) {
    if (skip("vacations", v.id) || /cancel/i.test(v.status ?? "")) continue;
    out.push(`Férias de ${formatDateBR(v.start_date)} a ${formatDateBR(v.end_date)}`);
  }
  for (const d of off.data ?? []) {
    if (skip("days_off", d.id) || (d.end_date || d.date) < from) continue;
    out.push(`Folga em ${formatDateBR(d.date)}${d.end_date ? ` a ${formatDateBR(d.end_date)}` : ""}`);
  }
  for (const m of med.data ?? []) {
    if (skip("medical_leaves", m.id)) continue;
    out.push(`Atestado de ${formatDateBR(m.start_date)} a ${formatDateBR(m.end_date)}`);
  }
  return out;
}

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

/**
 * Marca da bolinha de prêmio viagem (schedule_person_vt.pays_bonus) em cada linha de quadro de Integração
 * ("integracao:<cliente>"): devolve as linhas com `travel` (true/false da pessoa, null = padrão pela distância).
 */
export async function withIntegrationTravel<T extends { schedule_id?: string; box_key?: string; collaborator_id: string }>(rows: T[], boxKeys: string[]) {
  const sids = [...new Set(rows.map((r) => r.schedule_id).filter((x): x is string => !!x))];
  if (!sids.length || !boxKeys.length) return rows.map((r) => ({ ...r, travel: null as boolean | null }));
  const marks: any[] = [];
  for (let i = 0; i < sids.length; i += 150) {
    marks.push(...await fetchAll<any>((a, b) => supabase.from("schedule_person_vt").select("schedule_id, box_key, collaborator_id, pays_bonus")
      .in("schedule_id", sids.slice(i, i + 150)).in("box_key", boxKeys).order("schedule_id").order("box_key").order("collaborator_id").range(a, b)));
  }
  const by = new Map(marks.map((m) => [`${m.schedule_id}|${m.box_key}|${m.collaborator_id}`, m.pays_bonus as boolean | null]));
  return rows.map((r) => ({ ...r, travel: by.get(`${r.schedule_id}|${r.box_key}|${r.collaborator_id}`) ?? null }));
}

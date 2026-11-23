/**
 * Quem tem prêmio viagem ativo no dia, pela mesma regra da Programação (schedule-planner-board):
 * marcação da pessoa no dia (travel_bonus_override) senão serviço paga viagem no dia (schedule_work_travel, padrão pela
 * distância do cliente) + distância da cidade da pessoa (ou do alojamento) até a do cliente dentro de uma faixa ativa;
 * cadastro com prêmio desligado e alojamento que bloqueia benefícios nunca recebem.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildDistanceLookup } from "@/lib/city-distance";
import { effectiveCity, lodgingBlocksBenefits, lodgingOn, type LodgingStay } from "@/lib/lodging";

export { transportNeedsTravel } from "@/lib/schedule-alerts";

export type TravelAlloc = { collaborator_id: string; work_id: string; travel_bonus_override?: boolean | null };
export type TravelWork = { id: string; client_name?: string | null | undefined; client_city?: string | null | undefined; client_distance_km?: number | null | undefined };

export async function travelActiveIds(date: string, scheduleId: string | null, allocs: TravelAlloc[], works: TravelWork[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!allocs.length) return out;
  const ids = [...new Set(allocs.map((a) => a.collaborator_id))];
  const [rules, people, dist, workTravel, stays] = await Promise.all([
    supabase.from("travel_bonus_rules").select("minimum_distance, maximum_distance").eq("active", true),
    supabase.from("collaborators").select("id, city, travel_bonus_enabled").in("id", ids),
    supabase.from("city_distances").select("city_a, city_b, km"),
    scheduleId ? supabase.from("schedule_work_travel").select("work_id, pays_bonus").eq("schedule_id", scheduleId) : Promise.resolve({ data: [] as { work_id: string; pays_bonus: boolean | null }[] }),
    supabase.from("lodging_stays").select("collaborator_id, lodging, start_date, end_date").lte("start_date", date).or(`end_date.is.null,end_date.gte.${date}`),
  ]);
  const ranges = (rules.data ?? []).map((r) => ({ min: Number(r.minimum_distance), max: r.maximum_distance === null ? Infinity : Number(r.maximum_distance) }));
  const hit = (km: number) => ranges.some((r) => km >= r.min && km <= r.max);
  const person = new Map((people.data ?? []).map((p) => [p.id, p]));
  const distFor = buildDistanceLookup(dist.data ?? []);
  const paysBy = new Map((workTravel.data ?? []).map((w) => [w.work_id, w.pays_bonus]));
  const workBy = new Map(works.map((w) => [w.id, w]));
  const lodgings = (stays.data ?? []) as LodgingStay[];
  for (const a of allocs) {
    const p = person.get(a.collaborator_id);
    if (p?.travel_bonus_enabled === false) continue;
    if (a.travel_bonus_override != null) { if (a.travel_bonus_override) out.add(a.collaborator_id); continue; }
    const w = workBy.get(a.work_id);
    const pays = paysBy.get(a.work_id) ?? hit(Number(w?.client_distance_km ?? 0));
    const lodging = lodgingOn(lodgings, a.collaborator_id, date);
    if (!pays || lodgingBlocksBenefits(lodging, w?.client_name)) continue;
    if (hit(distFor(effectiveCity(p?.city, lodging), w?.client_city, Number(w?.client_distance_km ?? 0)))) out.add(a.collaborator_id);
  }
  return out;
}

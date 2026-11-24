import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { travelOnFor, vtBaseForDay, vtForDay, workVtDefault } from "@/lib/transport-rules";
import { nextBoxTravel, resolveBoxTravel } from "@/lib/schedule-box-benefits";
import { buildDistanceLookup } from "@/lib/city-distance";
import { effectiveCity, lodgingBlocksBenefits, lodgingBlocksVtAlways, lodgingOn, type LodgingStay } from "@/lib/lodging";
import type { ScheduleContext } from "@/lib/scheduling";
import { INTEGRATION_PREFIX, vtBoxDefault } from "@/components/schedule-planner/boxes";

type DayAppointment = { collaborator_id: string; type: string; pays_transport_voucher?: boolean | null };

/**
 * Benefícios da Programação (VT e prêmio viagem/pernoite): marcações da obra, da pessoa e dos quadros no dia, com a
 * regra única de lib/transport-rules.ts. Devolve as leituras, as regras por pessoa/obra e as gravações das bolinhas.
 */
export function useScheduleBenefits({
  date,
  scheduleId,
  ctx: ctxData,
  appointments,
  editable,
  ensureSchedule,
  onWriteError,
}: {
  date: string;
  scheduleId: string | null;
  ctx: ScheduleContext | undefined;
  appointments: DayAppointment[] | undefined;
  editable: boolean;
  ensureSchedule: () => Promise<string>;
  onWriteError: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const workById = (workId: string) => ctxData?.worksById?.get(workId);
  const workVt = useQuery({
    queryKey: ["work-vt", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_work_vt").select("work_id, pays_vt").eq("schedule_id", scheduleId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.work_id, r.pays_vt]));
    },
  });
  const workPaysVt = (workId: string) => workVtDefault(workVt.data?.get(workId), workById(workId)?.clients?.needs_transport_voucher);
  // Cadastro da pessoa para a regra de VT (cidade, VT desligado, VT cheio, cargo): vem do contexto do dia
  // (uma leitura de colaboradores só, em vez de três).
  const people = useMemo(() => {
    const city = new Map<string, string | null>();
    const noVt = new Set<string>();
    const full = new Set<string>();
    const travelOff = new Set<string>();
    const position = new Map<string, string>();
    for (const r of [...(ctxData?.collaborators ?? []), ...(ctxData?.inactiveCollaborators ?? [])]) {
      position.set(r.id, (r.position_id ? ctxData?.positionById?.get(r.position_id)?.name : null) ?? "");
      city.set(r.id, r.city ?? null);
      if (r.vt_enabled === false) noVt.add(r.id);
      if (r.vt_always_full) full.add(r.id);
      if (r.travel_bonus_enabled === false) travelOff.add(r.id);
    }
    return { city, noVt, full, travelOff, position };
  }, [ctxData]);
  // Alojamentos no dia (Americana: sem VT/prêmio na Suzano; Mogi Guaçu: como morador de Mogi Guaçu).
  const lodgingStays = useQuery({
    queryKey: ["lodging-stays", date],
    queryFn: async () => ((await supabase.from("lodging_stays").select("collaborator_id, lodging, start_date, end_date").lte("start_date", date).or(`end_date.is.null,end_date.gte.${date}`)).data ?? []) as LodgingStay[],
  });
  const lodgingOf = (collaboratorId: string) => lodgingOn(lodgingStays.data ?? [], collaboratorId, date);
  const lodgingBlocked = (workId: string, collaboratorId: string) =>
    lodgingBlocksBenefits(lodgingOf(collaboratorId), workById(workId)?.clients?.name);
  /** Entrada da regra única de VT (lib/transport-rules.ts) para a pessoa na obra no dia. */
  const vtInput = (workId: string, collaboratorId: string) => {
    const lodging = lodgingOf(collaboratorId);
    return {
      vtEnabled: !people.noVt.has(collaboratorId),
      lodgingBlocks: lodgingBlocked(workId, collaboratorId),
      vtNever: lodgingBlocksVtAlways(lodging, people.position.get(collaboratorId)),
      alwaysFull: people.full.has(collaboratorId) ?? false,
      workMark: workVt.data?.get(workId),
      clientDefault: workById(workId)?.clients?.needs_transport_voucher,
      // Alojado vale a cidade do alojamento (não a do cadastro) para a regra de Pouso Alegre.
      homeCity: effectiveCity(people.city.get(collaboratorId), lodging),
    };
  };
  const defaultAllocVt = (workId: string, collaboratorId: string) => {
    const i = vtInput(workId, collaboratorId);
    return vtBaseForDay(i) && !i.vtNever;
  };
  /** VT que vale na bolinha (VT cheio aparece verde; Montador alojado em MGG nunca). */
  const allocVtOn = (workId: string, collaboratorId: string, override: boolean | null | undefined) =>
    vtForDay({ ...vtInput(workId, collaboratorId), override });

  const toggleWorkVt = useMutation({
    mutationFn: async (workId: string) => {
      const id = await ensureSchedule();
      const { error } = await supabase
        .from("schedule_work_vt")
        .upsert({ schedule_id: id, work_id: workId, pays_vt: !workPaysVt(workId) }, { onConflict: "schedule_id,work_id" });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["work-vt", id] }),
    onError: onWriteError,
  });

  const workTravel = useQuery({
    queryKey: ["work-travel", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_work_travel").select("work_id, pays_bonus").eq("schedule_id", scheduleId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.work_id, r.pays_bonus]));
    },
  });
  // Prêmio viagem: por padrão segue as regras da aba Prêmio de Viagem (distância mínima cadastrada).
  const travelRules = useQuery({
    queryKey: ["travel-info"],
    queryFn: async () => {
      const [rules, dist] = await Promise.all([
        supabase.from("travel_bonus_rules").select("minimum_distance, maximum_distance").eq("active", true),
        supabase.from("city_distances").select("city_a, city_b, km"),
      ]);
      const ranges = (rules.data ?? []).map((r) => ({ min: Number(r.minimum_distance), max: r.maximum_distance === null ? Infinity : Number(r.maximum_distance) }));
      return {
        hit: (km: number) => ranges.some((r) => km >= r.min && km <= r.max),
        distFor: buildDistanceLookup(dist.data ?? []),
      };
    },
  });
  const travelInfo = useMemo(
    () => (travelRules.data && ctxData ? { ...travelRules.data, city: people.city, off: people.travelOff } : undefined),
    [travelRules.data, ctxData, people],
  );
  const workOf = (workId: string) => workById(workId);
  const workTravelDefault = (workId: string) => {
    const t = travelInfo;
    if (!t) return false;
    return t.hit(Number(workOf(workId)?.clients?.distance_km ?? 0));
  };
  const workPaysTravel = (workId: string) => workTravel.data?.get(workId) ?? workTravelDefault(workId);
  const defaultAllocTravel = (workId: string, collaboratorId: string) => {
    const t = travelInfo;
    if (!t) return false;
    const on = travelOnFor({
      enabled: !t.off.has(collaboratorId),
      lodgingBlocks: lodgingBlocked(workId, collaboratorId),
      workMark: workTravel.data?.get(workId),
      workDefault: workTravelDefault(workId),
    });
    if (!on) return false;
    const w = workOf(workId);
    const km = t.distFor(effectiveCity(t.city.get(collaboratorId), lodgingOf(collaboratorId)), w?.clients?.city, Number(w?.clients?.distance_km ?? 0));
    return t.hit(km);
  };
  const setGroupTravel = useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      const id = await ensureSchedule();
      const { error } = await supabase
        .from("schedule_work_travel")
        .upsert(ids.map((work_id) => ({ schedule_id: id, work_id, pays_bonus: value })), { onConflict: "schedule_id,work_id" });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["work-travel", id] }),
    onError: onWriteError,
  });
  const toggleAllocTravel = useMutation({
    mutationFn: async ({ id, workId, collaboratorId, current }: { id: string; workId: string; collaboratorId: string; current: boolean }) => {
      const next = !current;
      const override = next === defaultAllocTravel(workId, collaboratorId) ? null : next;
      const { error } = await supabase.from("daily_allocations").update({ travel_bonus_override: override }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allocations", scheduleId] }),
    onError: onWriteError,
  });
  const toggleOvernight = useMutation({
    mutationFn: async ({ id, current, travelOff }: { id: string; current: boolean; travelOff?: boolean | null }) => {
      const patch: { overnight: boolean; travel_bonus_override?: boolean | null } = { overnight: !current };
      if (current && travelOff !== undefined) patch.travel_bonus_override = travelOff;
      const { error } = await supabase.from("daily_allocations").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allocations", scheduleId] }),
    onError: onWriteError,
  });
  const setGroupOvernight = useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      if (!ids.length) return;
      const patch: { overnight: boolean; travel_bonus_override?: null } = { overnight: value };
      if (!value) patch.travel_bonus_override = null;
      const { error } = await supabase.from("daily_allocations").update(patch).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allocations", scheduleId] }),
    onError: onWriteError,
  });


  const toggleAllocVt = useMutation({
    mutationFn: async ({ id, workId, collaboratorId, current }: { id: string; workId: string; collaboratorId: string; current: boolean }) => {
      const next = !current;
      const override = next === defaultAllocVt(workId, collaboratorId) ? null : next;
      const { error } = await supabase.from("daily_allocations").update({ vt_override: override }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allocations", scheduleId] }),
    onError: onWriteError,
  });

  /** VT dos quadros de ASO / Treinamento / Integração. */
  const boxVt = useQuery({
    queryKey: ["box-vt", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const [b, p] = await Promise.all([
        supabase.from("schedule_box_vt").select("box_key, pays_vt, pays_bonus, overnight").eq("schedule_id", scheduleId!),
        supabase.from("schedule_person_vt").select("box_key, collaborator_id, pays_vt, pays_bonus, overnight").eq("schedule_id", scheduleId!),
      ]);
      if (b.error) throw b.error;
      if (p.error) throw p.error;
      return {
        box: new Map((b.data ?? []).map((r) => [r.box_key, r.pays_vt])),
        person: new Map((p.data ?? []).map((r) => [`${r.box_key}|${r.collaborator_id}`, r.pays_vt])),
        travelBox: new Map((b.data ?? []).map((r) => [r.box_key, r])),
        travelPerson: new Map((p.data ?? []).map((r) => [`${r.box_key}|${r.collaborator_id}`, r])),
      };
    },
  });
  const boxPaysVt = (key: string) => boxVt.data?.box.get(key) ?? vtBoxDefault(key) ?? false;
  const personPaysVt = (key: string, collaboratorId: string) => {
    const o = boxVt.data?.person.get(`${key}|${collaboratorId}`);
    if (o !== undefined) return o;
    if (key.startsWith(INTEGRATION_PREFIX)) {
      const a = (appointments ?? []).find(
        (x) => x.collaborator_id === collaboratorId && x.type === "integracao",
      );
      if (a?.pays_transport_voucher) return true;
    }
    return boxPaysVt(key);
  };
  /** Títulos editáveis das caixas (ex.: caixa personalizada). */
  const boxTitles = useQuery({
    queryKey: ["box-titles", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_box_titles")
        .select("box_key, title")
        .eq("schedule_id", scheduleId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.box_key, r.title]));
    },
  });
  const saveBoxTitle = useMutation({
    mutationFn: async ({ key, title }: { key: string; title: string }) => {
      const id = await ensureSchedule();
      const t = title.trim();
      if (!t) {
        const { error } = await supabase.from("schedule_box_titles").delete().eq("schedule_id", id).eq("box_key", key);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("schedule_box_titles")
          .upsert({ schedule_id: id, box_key: key, title: t }, { onConflict: "schedule_id,box_key" });
        if (error) throw error;
      }
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["box-titles", id] }),
    onError: onWriteError,
  });
  const toggleBoxVt = useMutation({
    mutationFn: async (key: string) => {
      const id = await ensureSchedule();
      const next = !boxPaysVt(key);
      const { error } = await supabase
        .from("schedule_box_vt")
        .upsert({ schedule_id: id, box_key: key, pays_vt: next }, { onConflict: "schedule_id,box_key" });
      if (error) throw error;
      // o quadro vale para todos: limpa exceções individuais do quadro
      const { error: personError } = await supabase.from("schedule_person_vt").update({ pays_vt: next }).eq("schedule_id", id).eq("box_key", key);
      if (personError) throw personError;
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["box-vt", id] }),
    onError: onWriteError,
  });
  const togglePersonVt = useMutation({
    mutationFn: async ({ key, collaboratorId }: { key: string; collaboratorId: string }) => {
      const id = await ensureSchedule();
      const next = !personPaysVt(key, collaboratorId);
      const { error } = await supabase
        .from("schedule_person_vt")
        .upsert(
          { schedule_id: id, box_key: key, collaborator_id: collaboratorId, pays_vt: next },
          { onConflict: "schedule_id,box_key,collaborator_id" },
        );
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["box-vt", id] }),
    onError: onWriteError,
  });

  const personDot = (key: string, collaboratorId: string) => {
    const on = personPaysVt(key, collaboratorId);
    const exception = boxVt.data?.person.has(`${key}|${collaboratorId}`) ?? false;
    const label = key === "aso" ? (on ? "2 VTs (ASO + adicional)" : "1 VT (ASO)") : on ? "Recebe VT" : "Sem VT";
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled={!editable}
        aria-label="Alternar VT do colaborador na caixa"
        title={`${label}${exception ? " (exceção)" : ""}`}
        onClick={(e) => { e.stopPropagation(); togglePersonVt.mutate({ key, collaboratorId }); }}
        className={`h-2 w-2 min-w-0 shrink-0 rounded-full p-0 ${on ? "bg-success hover:bg-success" : "bg-muted-foreground/40 hover:bg-muted-foreground/40"}`}
      />
    );
  };

  const boxTravel = (key: string, collaboratorId?: string) => resolveBoxTravel(
    boxVt.data?.travelBox.get(key) ?? { pays_bonus: false, overnight: false },
    collaboratorId ? boxVt.data?.travelPerson.get(`${key}|${collaboratorId}`) : undefined,
  );
  const toggleBoxTravel = useMutation({
    mutationFn: async ({ key, collaboratorId }: { key: string; collaboratorId?: string }) => {
      const id = await ensureSchedule();
      const next = nextBoxTravel(boxTravel(key, collaboratorId));
      if (collaboratorId) {
        const { error } = await supabase.from("schedule_person_vt").upsert({
          schedule_id: id, box_key: key, collaborator_id: collaboratorId,
          pays_vt: personPaysVt(key, collaboratorId), ...next,
        }, { onConflict: "schedule_id,box_key,collaborator_id" });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("schedule_box_vt").upsert({
          schedule_id: id, box_key: key, pays_vt: boxPaysVt(key), ...next,
        }, { onConflict: "schedule_id,box_key" });
        if (error) throw error;
        const { error: personError } = await supabase.from("schedule_person_vt")
          .update({ pays_bonus: null, overnight: null }).eq("schedule_id", id).eq("box_key", key);
        if (personError) throw personError;
      }
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["box-vt", id] }),
    onError: onWriteError,
  });
  const travelDot = (key: string, collaboratorId?: string) => {
    const state = boxTravel(key, collaboratorId);
    const color = state.overnight ? "bg-warning hover:bg-warning" : state.pays_bonus ? "bg-info hover:bg-info" : "bg-muted-foreground/40 hover:bg-muted-foreground/40";
    return <Button
      variant="ghost" size="icon"
      disabled={!editable || toggleBoxTravel.isPending}
      aria-label={collaboratorId ? "Alternar prêmio viagem / pernoite do colaborador na caixa" : "Alternar prêmio viagem / pernoite da caixa"}
      title={state.overnight ? "Pernoite: R$ 25,00 (clique para desligar)" : state.pays_bonus ? "Prêmio viagem ligado (clique para pernoite)" : "Prêmio viagem desligado (clique para ligar)"}
      onClick={(e) => { e.stopPropagation(); toggleBoxTravel.mutate(collaboratorId ? { key, collaboratorId } : { key }); }}
      className={cn("min-w-0 shrink-0 rounded-full p-0", collaboratorId ? "h-2 w-2" : "h-2.5 w-2.5 border border-border", color)}
    />;
  };
  const personBenefits = (key: string, collaboratorId: string) => <span className="flex shrink-0 flex-col items-center gap-0.5">
    {personDot(key, collaboratorId)}
    {key === "personalizada" && travelDot(key, collaboratorId)}
  </span>;

  const setGroupVt = useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      const id = await ensureSchedule();
      const { error } = await supabase
        .from("schedule_work_vt")
        .upsert(ids.map((work_id) => ({ schedule_id: id, work_id, pays_vt: value })), { onConflict: "schedule_id,work_id" });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ["work-vt", id] }),
    onError: onWriteError,
  });


  return {
    workVt, workPaysVt, lodgingStays, lodgingOf, defaultAllocVt, allocVtOn, toggleWorkVt,
    workTravel, travelRules, travelInfo, workPaysTravel, defaultAllocTravel, setGroupTravel, toggleAllocTravel, toggleOvernight, setGroupOvernight,
    toggleAllocVt, boxVt, boxPaysVt, personPaysVt, boxTitles, saveBoxTitle, toggleBoxVt, togglePersonVt,
    travelDot, personBenefits, toggleBoxTravel, setGroupVt,
  };
}

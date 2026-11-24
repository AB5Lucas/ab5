import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, GripVertical, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { industryKmOneWay, industryToll, useIndustryCustomers } from "@/components/industry-customer-select";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiFilter } from "@/components/multi-filter";
import { transportNeedsTravel, travelActiveIds } from "@/lib/travel-active";
import { dayKm } from "@/lib/fleet-costs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleCellEditor, useExistingDays, type EditorCtx } from "@/components/vehicle-timeline-editor";
import { VehicleTimelineCell } from "@/components/vehicle-timeline-cell";
import {
  EMPTY_FORM, EXTERNAL_KEY, KM_EXTERNAL, KM_SUZANO_LOCAL, KM_WORK, LOGISTICS_START, MAINTENANCE_KEY, NONE, REVISION_KEY, SUZANO_LOCAL_KEY, WORK_PREFIX,
  dateRange, driversByDay, fmtDay, isWeekend, rowDrivers, shortName, type CellForm, type VehicleScheduleRow,
} from "@/components/vehicle-timeline-shared";

export {
  EXTERNAL_KEY, MAINTENANCE_KEY, REVISION_KEY, SUZANO_LOCAL_KEY, KM_SUZANO_LOCAL, KM_WORK, KM_EXTERNAL, LOGISTICS_START,
} from "@/components/vehicle-timeline-shared";
export type { VehicleScheduleRow } from "@/components/vehicle-timeline-shared";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function monthKeyNow() {
  const now = new Date();
  // Período de fechamento: dia 26 do mês anterior até o dia 25 do mês selecionado.
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + (now.getDate() >= 26 ? 1 : 0), 1));
  return d.toISOString().slice(0, 7);
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 2, 26));
  const end = new Date(Date.UTC(y!, m! - 1, 25));
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function weekdayOf(iso: string) {
  return WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]!;
}

const SCHEDULE_COLS = "id, schedule_date, vehicle_id, driver_id, client_id, is_external, is_maintenance, maintenance_kind, driver_bonus, km, extra_client_ids, extra_driver_ids, extra_places, extra_work_ids, extra_km, trips, is_suzano_local, work_id, external_place, requester_id, driver_toggle, extra_requester_ids, extra_driver_toggles, adm_place, place_toll";

type BuildInput = {
  driver_id: string | null;
  client_id: string | null;
  is_external: boolean;
  is_maintenance: boolean;
  maintenance_kind?: string | null | undefined;
  driver_bonus: boolean;
  extra_client_ids?: string[] | undefined;
  extra_driver_ids?: string[] | undefined;
  extra_places?: string[] | undefined;
  extra_work_ids?: string[] | undefined;
  trips?: number | undefined;
  is_suzano_local?: boolean | undefined;
  work_id?: string | null | undefined;
  external_place?: string | null | undefined;
  adm_place?: string | null | undefined;
  km?: number | null | undefined;
  requester_id?: string | null | undefined;
  driver_toggle?: boolean | undefined;
  extra_requester_ids?: string[] | undefined;
  extra_driver_toggles?: boolean[] | undefined;
};
const rowInput = (s: VehicleScheduleRow): BuildInput => ({
  driver_id: s.driver_id, client_id: s.client_id, is_external: s.is_external, is_maintenance: s.is_maintenance ?? false, maintenance_kind: s.maintenance_kind,
  driver_bonus: s.driver_bonus, extra_client_ids: s.extra_client_ids, extra_driver_ids: s.extra_driver_ids, extra_places: s.extra_places, extra_work_ids: s.extra_work_ids,
  trips: s.trips, is_suzano_local: s.is_suzano_local, work_id: s.work_id, external_place: s.external_place, adm_place: s.adm_place, km: s.km,
  requester_id: s.requester_id, driver_toggle: s.driver_toggle, extra_requester_ids: s.extra_requester_ids, extra_driver_toggles: s.extra_driver_toggles,
});

export function VehicleTimeline() {
  const { canWrite } = useCurrentUser();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(monthKeyNow);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [cell, setCell] = useState<{ vehicleId: string; date: string; vehicleCnh: string | null; byWork: boolean } | null>(null);
  const [editorInitial, setEditorInitial] = useState<CellForm>(EMPTY_FORM);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyStart, setCopyStart] = useState("");
  const [copyEnd, setCopyEnd] = useState("");
  const [copySkipWeekend, setCopySkipWeekend] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcAll, setRecalcAll] = useState(false);
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const [rowDragOver, setRowDragOver] = useState<string | null>(null);
  const [needsDate, setNeedsDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      const saved = JSON.parse(localStorage.getItem("vehicle-needs-date") ?? "null") as
        | { day?: string; value?: string }
        | null;
      if (saved?.day === today && saved.value) return saved.value;
    } catch {
      /* ignora */
    }
    try {
      localStorage.setItem("vehicle-needs-date", JSON.stringify({ day: today, value: tomorrow }));
    } catch {
      /* ignora */
    }
    return tomorrow;
  });

  function changeNeedsDate(value: string) {
    setNeedsDate(value);
    try {
      localStorage.setItem(
        "vehicle-needs-date",
        JSON.stringify({ day: new Date().toISOString().slice(0, 10), value }),
      );
    } catch {
      /* ignora */
    }
  }

  const days = useMemo(() => monthDays(month), [month]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const SCROLL_KEY = "vehicle-timeline-scroll";

  function onTableScroll() {
    const el = scrollRef.current;
    if (!el) return;
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ left: el.scrollLeft, top: el.scrollTop }));
    } catch {
      /* ignora */
    }
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (!saved) return;
      const { left, top } = JSON.parse(saved) as { left?: number; top?: number };
      el.scrollLeft = left ?? 0;
      el.scrollTop = top ?? 0;
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(SCROLL_KEY); } catch { /* ignora */ }
    if (!saved) return;
    const { left, top } = JSON.parse(saved) as { left?: number; top?: number };
    const t = setTimeout(() => {
      el.scrollLeft = left ?? 0;
      el.scrollTop = top ?? 0;
    }, 100);
    return () => clearTimeout(t);
  }, [days.length]);

  const vehicles = useQuery({
    // Veículos inativos (ex.: placa fictícia ABC1234 do diesel avulso) não entram na programação.
    queryKey: ["vehicles", "timeline"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("plate");
      if (error) throw error;
      return (data ?? []).filter((v) => v.status !== "inactive");
    },
  });

  const drivers = useQuery({
    queryKey: ["timeline-drivers", "cnh"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, driver_license_category, driver_license_expiry")
        .eq("is_driver", true)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Solicitante do frete (caminhão/pickup): qualquer colaborador ativo, não só motorista.
  const people = useQuery({
    queryKey: ["timeline-people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, full_name").eq("status", "active").order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data]);

  const clients = useQuery({
    queryKey: ["timeline-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, name, distance_km, needs_company_transport, needs_transport_voucher, has_toll, toll_amount, trips_per_day",
        )
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const prefs = useQuery({
    queryKey: ["vehicle-view-prefs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_view_prefs")
        .select("hidden_vehicle_ids, vehicle_order")
        .maybeSingle();
      return {
        hidden: (data?.hidden_vehicle_ids ?? []) as string[],
        order: (data?.vehicle_order ?? []) as string[],
      };
    },
  });
  const hidden = useMemo(() => new Set(prefs.data?.hidden ?? []), [prefs.data]);
  const vehicleOrder = useMemo(() => prefs.data?.order ?? [], [prefs.data]);

  const savePrefs = useMutation({
    mutationFn: async (patch: { hidden?: string[]; order?: string[] }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("vehicle_view_prefs").upsert(
        {
          user_id: auth.user.id,
          hidden_vehicle_ids: patch.hidden ?? [...hidden],
          vehicle_order: patch.order ?? vehicleOrder,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vehicle-view-prefs"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const schedules = useQuery({
    queryKey: ["vehicle-schedules", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_schedules")
        .select(SCHEDULE_COLS)
        .gte("schedule_date", days[0]!)
        .lte("schedule_date", days[days.length - 1]!);
      if (error) throw error;
      return (data ?? []) as VehicleScheduleRow[];
    },
    enabled: days.length > 0,
  });

  // Demandas da Logística programadas para os veículos no mês (ícone na célula).
  const logDemands = useQuery({
    queryKey: ["vehicle-timeline-logistics", month],
    enabled: days.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("log_demands").select("id, title, vehicle_id, scheduled_date, departure_time, status")
        .not("vehicle_id", "is", null).gte("scheduled_date", days[0]!).lte("scheduled_date", days[days.length - 1]!).neq("status", "cancelada");
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const d of data ?? []) {
        const k = `${d.vehicle_id}|${d.scheduled_date}`;
        map.set(k, [...(map.get(k) ?? []), `${d.departure_time ? `${String(d.departure_time).slice(0, 5)} ` : ""}${d.title}`]);
      }
      return map;
    },
  });

  const byCell = useMemo(() => {
    const map = new Map<string, VehicleScheduleRow>();
    (schedules.data ?? []).forEach((s) => map.set(`${s.vehicle_id}|${s.schedule_date}`, s));
    return map;
  }, [schedules.data]);
  const dayDrivers = useMemo(() => driversByDay(schedules.data ?? []), [schedules.data]);

  const driverName = useMemo(() => {
    const map = new Map<string, string>();
    (drivers.data ?? []).forEach((d) => map.set(d.id, d.full_name));
    return map;
  }, [drivers.data]);

  const clientName = useMemo(() => {
    const map = new Map<string, string>();
    (clients.data ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clients.data]);

  const worksQ = useQuery({
    queryKey: ["vehicle-timeline-works"],
    queryFn: async () => {
      const { data } = await supabase.from("works").select("id, name, client_id, clients(name)").eq("active", true).order("name");
      return (data ?? []) as { id: string; name: string; client_id: string | null; clients: { name: string } | null }[];
    },
  });
  const workById = useMemo(() => new Map((worksQ.data ?? []).map((w) => [w.id, w])), [worksQ.data]);
  const vehicleById = useMemo(() => new Map((vehicles.data ?? []).map((v) => [v.id, v])), [vehicles.data]);
  const byWorkVehicle = (vehicleId: string) => !!vehicleById.get(vehicleId)?.assign_by_work;

  // Indústria com local escrito (antigo "Externo"): 100 km fixos no dia e sem prêmio de motorista.
  const industryIds = useMemo(() => new Set((clients.data ?? []).filter((c) => /ind[uú]stria/i.test(c.name ?? "")).map((c) => c.id)), [clients.data]);
  const isIndustryClient = useCallback((id: string | null | undefined) => !!id && industryIds.has(id), [industryIds]);
  // ADM: o km do dia é digitado na escala (vale para o Prêmio Motorista), não vem da distância do cliente.
  const admIds = useMemo(() => new Set((clients.data ?? []).filter((c) => /^adm$/i.test((c.name ?? "").trim())).map((c) => c.id)), [clients.data]);
  const isAdmClient = useCallback((id: string | null | undefined) => !!id && admIds.has(id), [admIds]);

  const industryCustomers = useIndustryCustomers();
  const clientKm = useMemo(() => {
    const map = new Map<string, number>();
    (clients.data ?? []).forEach((c) => {
      const isIndustry = /ind[uú]stria/i.test(c.name ?? "");
      const oneWay = Number(c.distance_km ?? 0) || 0;
      map.set(c.id, isIndustry ? KM_WORK : oneWay);
    });
    return map;
  }, [clients.data]);

  const orderedVehicles = useMemo(() => {
    const list = [...(vehicles.data ?? [])];
    const rank = new Map(vehicleOrder.map((id, i) => [id, i]));
    list.sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return String(a.plate).localeCompare(String(b.plate), "pt-BR");
    });
    return list;
  }, [vehicles.data, vehicleOrder]);

  const visibleVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    return orderedVehicles.filter((v) => {
      if (hidden.has(v.id)) return false;
      if (!q) return true;
      return [v.plate, v.model, v.brand].filter(Boolean).some((x) => String(x).toLowerCase().includes(q));
    });
  }, [orderedVehicles, vehicleSearch, hidden]);

  function reorderVehicle(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const ids = orderedVehicles.map((v) => v.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    savePrefs.mutate({ order: next });
  }

  const invalidateSchedules = () => {
    queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["km-report"] });
    queryClient.invalidateQueries({ queryKey: ["vehicle-existing-days"] });
  };

  const upsert = useMutation({
    mutationFn: async (rows: ReturnType<typeof buildRow>[]) => {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("vehicle_schedules")
        .upsert(rows, { onConflict: "schedule_date,vehicle_id" });
      if (error) throw error;
    },
    onSuccess: invalidateSchedules,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicle_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSchedules();
      toast.success("Programação removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Local da Indústria: km de ida do cadastro de clientes Indústria; sem km preenchido, os 100 km de antes.
  const placeKmOneWay = (place: string) => industryKmOneWay(industryCustomers.data, place) ?? KM_EXTERNAL;
  const placeExtraKm = (place: string) => { const k = industryKmOneWay(industryCustomers.data, place); return k != null ? k * 2 : KM_EXTERNAL; };

  function extraKm(id: string) {
    if (id === EXTERNAL_KEY) return KM_EXTERNAL;
    if (id === MAINTENANCE_KEY || id === REVISION_KEY) return 0;
    if (id === SUZANO_LOCAL_KEY) return KM_SUZANO_LOCAL;
    return clientKm.get(id) ?? 0;
  }

  function extraName(id: string, place?: string | null) {
    // Indústria com local digitado (viagem fora): aparece só o local, como era o Externo.
    if (place && (isIndustryClient(id) || isAdmClient(id))) return place.toUpperCase();
    if (id === EXTERNAL_KEY) return "EXTERNO";
    if (id === MAINTENANCE_KEY) return "MANUTENÇÃO";
    if (id === REVISION_KEY) return "REVISÃO";
    if (id === SUZANO_LOCAL_KEY) return "SUZANO LOCAL";
    return clientName.get(id) ?? "—";
  }

  function buildRow(vehicleId: string, date: string, f: BuildInput) {
    const workId = f.work_id ?? null;
    if (workId) f = { ...f, client_id: workById.get(workId)?.client_id ?? f.client_id };
    const special = f.is_external || f.is_maintenance || !!f.is_suzano_local;
    const industryPlace = !special && isIndustryClient(f.client_id) ? (f.external_place ?? "").trim() : "";
    // ADM: o local digitado é só o nome que aparece (fica em adm_place; external_place é o da Indústria, que tira o prêmio).
    const admPlace = !special && isAdmClient(f.client_id) ? ((f.external_place ?? "").trim() || (f.adm_place ?? "").trim()) : "";
    const pairs = (f.extra_client_ids ?? [])
          .map((c, i) => ({ c, d: f.extra_driver_ids?.[i] ?? "", place: isIndustryClient(c) || isAdmClient(c) ? (f.extra_places?.[i] ?? "").trim() : "", w: f.extra_work_ids?.[i] ?? "",
            r: f.extra_requester_ids?.[i] ?? "", t: !!f.extra_driver_toggles?.[i] }))
          .filter((p) => p.c && p.c !== NONE);
    const extras = pairs.map((p) => p.c);
    return {
      schedule_date: date,
      vehicle_id: vehicleId,
      driver_id: f.driver_id,
      client_id: special ? null : f.client_id,
      is_external: f.is_external,
      is_maintenance: f.is_maintenance,
      maintenance_kind: f.is_maintenance ? (f.maintenance_kind === "revisao" ? "revisao" : "manutencao") : null,
      driver_bonus: f.is_external || f.is_maintenance || industryPlace ? false : f.driver_bonus,
      trips: Math.max(1, Math.floor(Number(f.trips ?? 1)) || 1),
      is_suzano_local: !!f.is_suzano_local,
      km: f.is_maintenance ? 0 : f.is_external ? KM_EXTERNAL : industryPlace ? placeKmOneWay(industryPlace) : f.is_suzano_local ? KM_SUZANO_LOCAL
        : !special && isAdmClient(f.client_id) && f.km != null && Number.isFinite(Number(f.km)) ? Math.max(0, Number(f.km))
        : f.client_id ? clientKm.get(f.client_id) ?? 0 : 0,
      extra_client_ids: extras,
      extra_driver_ids: pairs.map((p) => (p.d === NONE ? "" : p.d)),
      requester_id: f.requester_id ?? null,
      driver_toggle: !!f.driver_toggle,
      extra_requester_ids: pairs.map((p) => (p.r === NONE ? "" : p.r)),
      extra_driver_toggles: pairs.map((p) => p.t),
      extra_places: pairs.map((p) => p.place),
      extra_work_ids: pairs.map((p) => (p.w && workById.get(p.w)?.client_id === p.c ? p.w : "")),
      // Indústria com local: km de ida do cliente Indústria × 2; sem km cadastrado, 100 km como antes.
      extra_km: pairs.reduce((s, p) => s + (p.place && isIndustryClient(p.c) ? placeExtraKm(p.place) : extraKm(p.c)), 0),
      work_id: special ? null : workId,
      external_place: f.is_external ? (f.external_place ?? "").trim() || null : industryPlace || null,
      adm_place: admPlace || null,
      // Pedágio (ida) do local Indústria cadastrado; substitui o do cliente nos custos. Sem cadastro, segue o do cliente.
      place_toll: industryPlace ? industryToll(industryCustomers.data, industryPlace) : null,
    };
  }

  function openCell(vehicleId: string, date: string) {
    if (!canWrite) return;
    const current = byCell.get(`${vehicleId}|${date}`);
    // Caminhão/pickup: a linha de cima é o Solicitante (antes era o motorista); o Motorista marcado fica no toggle.
    const bw = byWorkVehicle(vehicleId);
    const req = current?.requester_id ?? current?.driver_id ?? NONE;
    const chosen = (d: string | null | undefined, r: string, on: boolean) => (on && d && d !== r ? d : NONE);
    const extraReq = (current?.extra_client_ids ?? []).map((_, i) => current?.extra_requester_ids?.[i] || current?.extra_driver_ids?.[i] || NONE);
    setEditorInitial({
      requester_id: bw ? req : NONE,
      driver_toggle: bw ? !!current?.driver_toggle : false,
      extraRequesters: bw ? extraReq : (current?.extra_client_ids ?? []).map(() => NONE),
      extraToggles: (current?.extra_client_ids ?? []).map((_, i) => bw && !!current?.extra_driver_toggles?.[i]),
      driver_id: bw ? chosen(current?.driver_id, req, !!current?.driver_toggle) : current?.driver_id ?? NONE,
      client_id: current
        ? current.is_maintenance
          ? current.maintenance_kind === "revisao" ? REVISION_KEY : MAINTENANCE_KEY
          : current.is_external
            ? EXTERNAL_KEY
            : current.is_suzano_local
              ? SUZANO_LOCAL_KEY
              : current.work_id
                ? WORK_PREFIX + current.work_id
                : current.client_id ?? NONE
        : NONE,
      driver_bonus: current?.driver_bonus ?? false,
      repeat_until: "",
      skip_weekend: true,
      extras: [...(current?.extra_client_ids ?? [])],
      extraDrivers: (current?.extra_client_ids ?? []).map((_, i) => bw
        ? chosen(current?.extra_driver_ids?.[i], extraReq[i]!, !!current?.extra_driver_toggles?.[i])
        : current?.extra_driver_ids?.[i] || NONE),
      extraPlaces: (current?.extra_client_ids ?? []).map((_, i) => current?.extra_places?.[i] ?? ""),
      extraWorks: (current?.extra_client_ids ?? []).map((_, i) => current?.extra_work_ids?.[i] ?? ""),
      trips: String(current?.trips ?? 1),
      external_place: current?.external_place ?? current?.adm_place ?? "",
      km: current && isAdmClient(current.client_id) ? String(current.km ?? "") : "",
    });
    setCell({ vehicleId, date, vehicleCnh: (vehicleById.get(vehicleId) as { cnh_category?: string | null } | undefined)?.cnh_category ?? null, byWork: bw });
  }

  function saveCell(form: CellForm, repeatTargets: string[]) {
    if (!cell) return;
    if (form.client_id === NONE) {
      toast.error("Selecione a obra/cliente ou MANUTENÇÃO.");
      return;
    }
    const isExternal = form.client_id === EXTERNAL_KEY;
    const isRevision = form.client_id === REVISION_KEY;
    const isMaintenance = form.client_id === MAINTENANCE_KEY || isRevision;
    const isLocal = form.client_id === SUZANO_LOCAL_KEY;
    const workId = form.client_id.startsWith(WORK_PREFIX) ? form.client_id.slice(WORK_PREFIX.length) : null;
    // Caminhão/pickup: o motorista que vale (prêmio, CNH, ranking) é o marcado no toggle; sem ele, o solicitante.
    const bw = cell.byWork;
    // Sem motorista marcado, o solicitante só vale como motorista se for motorista (senão fica a definir).
    const isDriver = new Set((drivers.data ?? []).map((d) => d.id));
    const eff = (on: boolean, d: string, r: string) => (bw ? (on && d !== NONE ? d : isDriver.has(r) ? r : NONE) : d);
    const mainDriver = eff(form.driver_toggle, form.driver_id, form.requester_id);
    const base: BuildInput = {
      work_id: workId,
      driver_id: mainDriver === NONE ? null : mainDriver,
      requester_id: bw && form.requester_id !== NONE ? form.requester_id : null,
      driver_toggle: bw && form.driver_toggle,
      extra_requester_ids: form.extras.map((_, i) => (bw && form.extraRequesters[i] && form.extraRequesters[i] !== NONE ? form.extraRequesters[i]! : "")),
      extra_driver_toggles: form.extras.map((_, i) => bw && !!form.extraToggles[i]),
      client_id: isExternal || isMaintenance || isLocal ? null : workId ? workById.get(workId)?.client_id ?? null : form.client_id,
      is_suzano_local: isLocal,
      trips: Number(form.trips) || 1,
      is_external: isExternal,
      is_maintenance: isMaintenance,
      maintenance_kind: isRevision ? "revisao" : isMaintenance ? "manutencao" : null,
      driver_bonus: form.driver_bonus,
      extra_client_ids: form.extras,
      extra_driver_ids: form.extras.map((_, i) => eff(!!form.extraToggles[i], form.extraDrivers[i] ?? NONE, form.extraRequesters[i] ?? NONE)),
      extra_places: form.extraPlaces,
      extra_work_ids: form.extraWorks,
      external_place: form.external_place,
      km: form.km.trim() === "" ? null : Number(form.km.replace(",", ".")),
    };
    const targets = [cell.date, ...repeatTargets];
    upsert.mutate(targets.map((d) => buildRow(cell.vehicleId, d, base)));
    setCell(null);
  }

  function onDrop(vehicleId: string, date: string, payload: string) {
    if (!canWrite) return;
    try {
      const src = JSON.parse(payload) as VehicleScheduleRow;
      upsert.mutate([buildRow(vehicleId, date, rowInput(src))]);
    } catch {
      /* ignore */
    }
  }

  // Callbacks estáveis para as células memorizadas (sempre chamam a versão atual).
  const openRef = useRef(openCell);
  openRef.current = openCell;
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const onOpenCell = useCallback((v: string, d: string) => openRef.current(v, d), []);
  const onDropCell = useCallback((v: string, d: string, p: string) => dropRef.current(v, d, p), []);

  // ---- Copiar dia: prévia dos dias que já têm programação (serão sobrescritos) ----
  const copySource = useQuery({
    queryKey: ["vehicle-copy-source", copyFrom],
    enabled: copyOpen && !!copyFrom,
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_schedules").select(SCHEDULE_COLS).eq("schedule_date", copyFrom);
      if (error) throw error;
      return (data ?? []) as VehicleScheduleRow[];
    },
  });
  const copyLast = copyEnd && copyEnd >= copyStart ? copyEnd : copyStart;
  const copyTargets = copyStart ? dateRange(copyStart, copyLast, copySkipWeekend) : [];
  const copyVehicleIds = useMemo(() => (copySource.data ?? []).map((s) => s.vehicle_id), [copySource.data]);
  const copyExisting = useExistingDays(copyVehicleIds, copyOpen && copyVehicleIds.length ? copyStart : "", copyOpen && copyVehicleIds.length ? copyLast : "");
  const copyOverwritten = useMemo(() => {
    const t = new Set(copyTargets);
    const by = new Map<string, number>();
    for (const r of copyExisting.data ?? []) if (t.has(r.schedule_date)) by.set(r.schedule_date, (by.get(r.schedule_date) ?? 0) + 1);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [copyExisting.data, copyTargets.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function runCopyDay() {
    if (!copyFrom || !copyStart) {
      toast.error("Informe a data de origem e o destino.");
      return;
    }
    const source = copySource.data ?? [];
    if (source.length === 0) {
      toast.error("Não há programação na data de origem.");
      return;
    }
    const rows = copyTargets.filter((d) => d !== copyFrom).flatMap((d) => source.map((s) => buildRow(s.vehicle_id, d, rowInput(s))));
    if (!rows.length) {
      toast.error("Nenhum dia de destino.");
      return;
    }
    upsert.mutate(rows);
    toast.success(`${rows.length} programações copiadas.`);
    setCopyOpen(false);
  }

  // ---- Recalcular km Indústria (antes rodava sozinho ao abrir a página e mexia em meses fechados) ----
  const currentPeriodStart = monthDays(monthKeyNow())[0]!;
  const recalcFrom = recalcAll || currentPeriodStart < LOGISTICS_START ? LOGISTICS_START : currentPeriodStart;
  const placesSig = (industryCustomers.data ?? []).map((c) => `${c.name}|${c.km_one_way}|${c.has_toll}|${c.toll_amount}`).join(";");
  const recalcPreview = useQuery({
    queryKey: ["industry-km-recalc", recalcFrom, placesSig],
    enabled: recalcOpen && !!industryCustomers.data && !!clients.data && !!worksQ.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_schedules").select(SCHEDULE_COLS)
        .gte("schedule_date", recalcFrom).or("external_place.not.is.null,extra_places.neq.{}").order("schedule_date");
      if (error) throw error;
      const out: { row: VehicleScheduleRow; km: number; extra_km: number; place_toll: number | null }[] = [];
      const same = (x: number | null | undefined, y: number | null | undefined) => (x == null && y == null) || Number(x) === Number(y);
      for (const s of (data ?? []) as VehicleScheduleRow[]) {
        if (s.is_external) continue;
        // Só os dias com algum local cadastrado; o resto fica como foi lançado.
        if (![s.external_place, ...(s.extra_places ?? [])].some((p) => p && (industryKmOneWay(industryCustomers.data, p) != null || industryToll(industryCustomers.data, p) != null))) continue;
        const b = buildRow(s.vehicle_id, s.schedule_date, { ...rowInput(s), trips: s.trips ?? 1 });
        if (same(b.km, s.km) && same(b.extra_km, s.extra_km) && same(b.place_toll, s.place_toll)) continue;
        out.push({ row: s, km: b.km, extra_km: b.extra_km, place_toll: b.place_toll });
      }
      return out;
    },
  });
  const applyRecalc = useMutation({
    mutationFn: async () => {
      const list = recalcPreview.data ?? [];
      // Gravação em lote: só km, km extra e pedágio do local (as demais colunas não mudam).
      for (let i = 0; i < list.length; i += 200) {
        const { error } = await supabase.from("vehicle_schedules").upsert(
          list.slice(i, i + 200).map((c) => ({ schedule_date: c.row.schedule_date, vehicle_id: c.row.vehicle_id, km: c.km, extra_km: c.extra_km, place_toll: c.place_toll })),
          { onConflict: "schedule_date,vehicle_id" },
        );
        if (error) throw error;
      }
      return list.length;
    },
    onSuccess: (n) => {
      invalidateSchedules();
      queryClient.invalidateQueries({ queryKey: ["industry-km-recalc"] });
      toast.success(`Km/pedágio de ${n} dia(s) atualizados pelo cadastro de clientes Indústria`);
      setRecalcOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Necessidades de transporte ----
  const needs = useQuery({
    queryKey: ["transport-needs", needsDate],
    queryFn: async () => {
      const { data: sched } = await supabase
        .from("daily_schedules")
        .select("id")
        .eq("schedule_date", needsDate)
        .maybeSingle();
      const counts: Record<string, number> = {};
      if (sched) {
        // Quem está ausente (férias, atestado, folga) ou com compromisso agendado
        // não conta como passageiro, mesmo que tenha sobrado uma alocação antiga.
        const [vacations, leaves, daysOff, appts, allocs] = await Promise.all([
          supabase
            .from("vacations")
            .select("collaborator_id")
            .lte("start_date", needsDate)
            .gte("end_date", needsDate),
          supabase
            .from("medical_leaves")
            .select("collaborator_id")
            .lte("start_date", needsDate)
            .gte("end_date", needsDate),
          supabase
            .from("days_off")
            .select("collaborator_id")
            .lte("date", needsDate)
            .or(`end_date.gte.${needsDate},and(end_date.is.null,date.eq.${needsDate})`),
          supabase
            .from("appointments")
            .select("collaborator_id, type, client_id")
            .eq("scheduled_date", needsDate)
            .neq("status", "cancelled"),
          supabase
            .from("daily_allocations")
            .select("collaborator_id, work_id, travel_bonus_override, works(client_id, clients(name, city, distance_km))")
            .eq("schedule_id", sched.id),
        ]);
        const unavailable = new Set<string>();
        [vacations.data, leaves.data, daysOff.data, appts.data].forEach((list) =>
          (list ?? []).forEach((r) => unavailable.add(r.collaborator_id)),
        );
        type A = { collaborator_id: string; work_id: string; travel_bonus_override: boolean | null; works: { client_id: string | null; clients: { name: string | null; city: string | null; distance_km: number | null } | null } | null };
        const list = ((allocs.data ?? []) as unknown as A[]).filter((a) => !unavailable.has(a.collaborator_id));
        // Três Corações: só conta quem tem prêmio viagem ativo (quem mora perto vai por conta e não pede carro).
        const travelOnly = list.filter((a) => transportNeedsTravel(a.works?.clients?.name));
        const traveling = travelOnly.length
          ? await travelActiveIds(needsDate, sched.id, travelOnly, travelOnly.map((a) => ({ id: a.work_id, client_name: a.works?.clients?.name, client_city: a.works?.clients?.city, client_distance_km: a.works?.clients?.distance_km })))
          : new Set<string>();
        list.forEach((a) => {
          const cid = a.works?.client_id;
          if (!cid) return;
          if (transportNeedsTravel(a.works?.clients?.name) && !traveling.has(a.collaborator_id)) return;
          counts[cid] = (counts[cid] ?? 0) + 1;
        });
      }
      // Integrações agendadas também viajam para o cliente e somam na necessidade.
      const { data: integ } = await supabase
        .from("appointments")
        .select("collaborator_id, type, client_id")
        .eq("scheduled_date", needsDate)
        .neq("status", "cancelled");
      const seen = new Set<string>();
      (integ ?? []).forEach((a) => {
        if (!a.client_id || !String(a.type).toLowerCase().startsWith("integ")) return;
        const k = `${a.collaborator_id}|${a.client_id}`;
        if (seen.has(k)) return;
        seen.add(k);
        counts[a.client_id] = (counts[a.client_id] ?? 0) + 1;
      });

      const { data: vs } = await supabase
        .from("vehicle_schedules")
        .select("client_id, vehicle_id, trips, is_suzano_local")
        .eq("schedule_date", needsDate);
      return { counts, vehicleRows: vs ?? [] };
    },
  });

  const capacityOf = useMemo(() => {
    const map = new Map<string, number>();
    (vehicles.data ?? []).forEach((v) => map.set(v.id, v.passenger_capacity ?? 0));
    return map;
  }, [vehicles.data]);

  const needsRows = useMemo(() => {
    const counts = needs.data?.counts ?? {};
    const all = clients.data ?? [];
    const suzanoId = (all.find((c) => /^suzano$/i.test((c.name ?? "").trim())) ?? all.find((c) => /suzano/i.test(c.name ?? "")))?.id;
    const rows = all
      .filter((c) => c.needs_company_transport)
      .map((c) => {
        const people = counts[c.id] ?? 0;
        // Carros em SUZANO LOCAL também contam como transporte da Suzano.
        const vehicleRows = (needs.data?.vehicleRows ?? []).filter(
          (v) => v.client_id === c.id || (c.id === suzanoId && v.is_suzano_local),
        );
        // Em clientes com mais de uma viagem o mesmo motorista retorna: a 1ª viagem leva a lotação
        // cheia e as seguintes uma pessoa a menos (ex.: Suzano, 6 e depois 5).
        const seats = vehicleRows.reduce((s, v) => {
          const cap = capacityOf.get(v.vehicle_id) ?? 0;
          const trips = Math.max(1, Number(v.trips ?? 1) || 1);
          return s + cap + Math.max(0, cap - 1) * (trips - 1);
        }, 0);
        return { id: c.id, name: c.name, people, vehicles: vehicleRows.length, seats };
      })
      .filter((r) => r.people > 0 || r.vehicles > 0);
    return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [clients.data, needs.data, capacityOf]);

  // Toggle Motorista ligado e ainda em "Definir" (sem motorista escolhido, ou igual ao solicitante) em algum frete do dia.
  const driverUndefined = (r: VehicleScheduleRow) =>
    (!!r.driver_toggle && (!r.driver_id || r.driver_id === r.requester_id))
    || (!!r.requester_id && !r.driver_id)
    || (r.extra_client_ids ?? []).some((_, i) => !!r.extra_driver_toggles?.[i] && (!r.extra_driver_ids?.[i] || r.extra_driver_ids[i] === r.extra_requester_ids?.[i]));

  const plateOf = useCallback((id: string) => vehicleById.get(id)?.plate ?? "—", [vehicleById]);
  const editorCtx: EditorCtx = useMemo(() => ({
    clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    works: worksQ.data ?? [],
    workById,
    drivers: drivers.data ?? [],
    people: people.data ?? [],
    isIndustryClient,
    isAdmClient,
    clientKm,
    industryCustomers: industryCustomers.data,
    plateOf,
    driversOn: (date: string) => dayDrivers.get(date) ?? new Map<string, Set<string>>(),
  }), [clients.data, worksQ.data, workById, drivers.data, people.data, isIndustryClient, isAdmClient, clientKm, industryCustomers.data, plateOf, dayDrivers]);

  /** Textos prontos da célula (a célula é memorizada e só redesenha quando eles mudam). */
  function cellProps(vehicleId: string, d: string) {
    const row = byCell.get(`${vehicleId}|${d}`);
    const logistics = logDemands.data?.get(`${vehicleId}|${d}`)?.join(" · ");
    if (!row) return { row, driverText: "", placeText: "", extrasTitle: undefined, extrasCount: 0, km: 0, bonusTone: "none" as const, dupDriver: undefined, logistics };
    const dup = rowDrivers(row).filter((id) => (dayDrivers.get(d)?.get(id)?.size ?? 0) > 1);
    return {
      row,
      driverText: row.driver_id ? shortName(driverName.get(row.driver_id) ?? personName.get(row.driver_id) ?? "—") : row.requester_id ? `${shortName(personName.get(row.requester_id) ?? "—")} · solic.` : "Sem motorista",
      placeText: row.is_maintenance
        ? row.maintenance_kind === "revisao" ? "REVISÃO" : "MANUTENÇÃO"
        : row.is_external
          ? (row.external_place || "EXTERNO").toUpperCase()
          : row.is_suzano_local
            ? "SUZANO LOCAL"
            : row.external_place && isIndustryClient(row.client_id)
              ? row.external_place.toUpperCase()
              : row.adm_place && isAdmClient(row.client_id)
                ? row.adm_place.toUpperCase()
                : clientName.get(row.client_id ?? "") ?? "—",
      extrasTitle: (row.extra_client_ids ?? []).length
        ? `+ ${(row.extra_client_ids ?? []).map((id, i) => { const dr = row.extra_driver_ids?.[i]; return `${extraName(id, row.extra_places?.[i])}${dr ? ` (${driverName.get(dr) ?? "—"})` : ""}`; }).join(", ")}`
        : undefined,
      extrasCount: (row.extra_client_ids ?? []).length,
      km: dayKm({ km: row.km, trips: row.trips ?? 1, extra_km: row.extra_km ?? 0 }),
      bonusTone: driverUndefined(row) ? "undefined" as const : row.driver_bonus ? "bonus" as const : "none" as const,
      dupDriver: dup.length
        ? `${dup.map((id) => driverName.get(id) ?? personName.get(id) ?? "Motorista").join(", ")} também é motorista de outro veículo neste dia: ${dup.flatMap((id) => [...(dayDrivers.get(d)?.get(id) ?? [])].filter((v) => v !== vehicleId)).map(plateOf).join(", ")}`
        : undefined,
      logistics,
    };
  }

  const currentRow = cell ? byCell.get(`${cell.vehicleId}|${cell.date}`) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="block">Mês</Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="block">Buscar</Label>
          <div className="relative min-w-[200px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Modelo ou placa"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
            />
          </div>
        </div>

        <MultiFilter
          title="Veículos"
          mode="show"
          hint="Marque os veículos exibidos na timeline."
          options={orderedVehicles.map((v) => ({ value: v.id, label: `${[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"} · ${v.plate}` }))}
          values={orderedVehicles.filter((v) => !hidden.has(v.id)).map((v) => v.id)}
          onChange={(vis) => {
            const shown = new Set(vis);
            const listed = new Set(orderedVehicles.map((v) => v.id));
            savePrefs.mutate({ hidden: [...[...hidden].filter((id) => !listed.has(id)), ...orderedVehicles.filter((v) => !shown.has(v.id)).map((v) => v.id)] });
          }}
        />

        <Button variant="outline" onClick={() => setCopyOpen(true)} disabled={!canWrite}>
          <Copy className="h-4 w-4" /> Copiar dia
        </Button>
        <Button variant="outline" onClick={() => setRecalcOpen(true)} disabled={!canWrite} title="Recalcula km, km extra e pedágio dos dias com local Indústria cadastrado, com prévia antes de gravar.">
          <RefreshCw className="h-4 w-4" /> Recalcular km Indústria
        </Button>
      </div>

      <div className="panel overflow-auto" ref={scrollRef} onScroll={onTableScroll}>
        <table className="w-max border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 w-40 min-w-40 border-b border-r border-border bg-card px-2 py-1 text-left text-[11px] shadow-[inset_-1px_0_0_0_hsl(var(--border))]">
                Veículo
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`w-24 min-w-24 border-b border-r border-border px-1 py-0.5 text-center text-[10px] font-medium leading-tight ${isWeekend(d) ? "bg-muted/60" : "bg-card"}`}
                >
                  {d.slice(8)}/{d.slice(5, 7)} <span className="uppercase text-muted-foreground">{weekdayOf(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleVehicles.length === 0 && (
              <tr>
                <td colSpan={days.length + 1} className="p-4 text-muted-foreground">
                  Nenhum veículo visível. Ajuste a busca ou o filtro de veículos.
                </td>
              </tr>
            )}
            {visibleVehicles.map((v) => (
              <tr key={v.id}>
                <td
                  className={`sticky left-0 z-10 w-40 min-w-40 border-b border-r border-border bg-card px-2 py-1 align-middle leading-tight shadow-[inset_-1px_0_0_0_hsl(var(--border))] ${
                    rowDragOver === v.id ? "outline outline-1 outline-primary" : ""
                  }`}
                  onDragOver={(e) => {
                    if (!canWrite || !rowDragId || rowDragId === v.id) return;
                    e.preventDefault();
                    setRowDragOver(v.id);
                  }}
                  onDragLeave={() => setRowDragOver((cur) => (cur === v.id ? null : cur))}
                  onDrop={(e) => {
                    if (!rowDragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    reorderVehicle(rowDragId, v.id);
                    setRowDragId(null);
                    setRowDragOver(null);
                  }}
                >
                  <div className="flex items-center gap-1">
                    <div
                      draggable={canWrite}
                      title="Arraste para reordenar"
                      onDragStart={(e) => {
                        setRowDragId(v.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", "");
                      }}
                      onDragEnd={() => {
                        setRowDragId(null);
                        setRowDragOver(null);
                      }}
                      className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium">
                        {[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"}
                      </div>
                      <div className="font-mono text-[10px] uppercase text-muted-foreground">
                        {v.plate} · {v.passenger_capacity} lug.
                      </div>
                    </div>
                  </div>
                </td>
                {days.map((d) => (
                  <VehicleTimelineCell key={d} vehicleId={v.id} date={d} weekend={isWeekend(d)} canWrite={canWrite}
                    onOpen={onOpenCell} onDropRow={onDropCell} {...cellProps(v.id, d)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Km na célula = km rodados no dia (ida e volta × viagens + fretes extras), o mesmo da Frota. Ícone de caixa = demanda da Logística no veículo; triângulo = motorista em mais de um veículo no dia.
      </p>

      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Necessidades de Transporte</h3>
          <Input type="date" value={needsDate} onChange={(e) => changeNeedsDate(e.target.value)} className="w-44" />
        </div>
        {needsRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum cliente com transporte da empresa programado nesta data.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {needsRows.map((r) => {
              const ok = r.seats >= r.people;
              return (
                <div key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.people} colaboradores escalados</p>
                  <p className="text-xs text-muted-foreground">{r.people} vagas necessárias</p>
                  <p className="text-xs text-muted-foreground">
                    {r.vehicles} veículo(s) escalado(s) · {r.seats} vagas disponíveis
                  </p>
                  <Badge variant={ok ? "default" : "destructive"} className="mt-1">
                    {ok ? "✅ Transporte atendido" : `⚠️ Faltam ${r.people - r.seats} vagas`}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <VehicleCellEditor
        key={cell ? `${cell.vehicleId}|${cell.date}` : "closed"}
        cell={cell}
        initial={editorInitial}
        ctx={editorCtx}
        hasRow={!!currentRow}
        saving={upsert.isPending}
        onClose={() => setCell(null)}
        onRemove={() => { if (currentRow) remove.mutate(currentRow.id); setCell(null); }}
        onSave={saveCell}
      />

      {/* Copiar dia */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copiar programação</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Copiar de</Label>
              <Input type="date" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} />
              {copyFrom && copySource.data && <p className="text-xs text-muted-foreground">{copySource.data.length} veículo(s) programado(s) nesse dia.</p>}
            </div>
            <div className="space-y-1">
              <Label>Para (início)</Label>
              <Input type="date" value={copyStart} onChange={(e) => setCopyStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Para (fim, opcional)</Label>
              <Input type="date" value={copyEnd} onChange={(e) => setCopyEnd(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={copySkipWeekend} onCheckedChange={(v) => setCopySkipWeekend(!!v)} />
              Pular sábado e domingo
            </label>
            {copyTargets.length > 0 && (
              <div className={`rounded-md border p-2 text-xs ${copyOverwritten.length ? "border-warning/50 bg-warning/10" : "border-border text-muted-foreground"}`}>
                <p>Copiar para {copyTargets.length} dia(s): {copyTargets.map(fmtDay).join(", ")}.</p>
                {copyOverwritten.length > 0 ? (
                  <p className="mt-1 font-medium">
                    Já têm programação desses veículos e serão sobrescritos: {copyOverwritten.map(([d, n]) => `${fmtDay(d)} (${n})`).join(", ")}.
                  </p>
                ) : copyExisting.isFetching ? <p className="mt-1">Conferindo dias já programados…</p> : <p className="mt-1">Nenhum desses dias tem programação dos veículos copiados.</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>Cancelar</Button>
            <Button onClick={runCopyDay} disabled={!copySource.data?.length || copyExisting.isFetching}>
              {copyOverwritten.length ? `Copiar e sobrescrever ${copyOverwritten.length} dia(s)` : "Copiar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recalcular km Indústria */}
      <Dialog open={recalcOpen} onOpenChange={setRecalcOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Recalcular km Indústria</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Dias com local do cadastro de clientes Indústria: km de ida, km extra e pedágio do local voltam a ser os do cadastro.
            Por padrão só a partir de {fmtDay(recalcFrom)}/{recalcFrom.slice(0, 4)} (período atual), para não mexer em meses fechados.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={recalcAll} onCheckedChange={(v) => setRecalcAll(!!v)} />
            Incluir meses anteriores (desde {LOGISTICS_START.split("-").reverse().join("/")})
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {recalcPreview.isFetching ? (
              <p className="p-3 text-sm text-muted-foreground">Calculando…</p>
            ) : (recalcPreview.data ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Nada a mudar: os dias já estão com o km e o pedágio do cadastro.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr><th className="px-2 py-1">Dia</th><th className="px-2 py-1">Veículo</th><th className="px-2 py-1">Local</th><th className="px-2 py-1 text-right">Km ida</th><th className="px-2 py-1 text-right">Km extra</th><th className="px-2 py-1 text-right">Pedágio</th></tr>
                </thead>
                <tbody>
                  {(recalcPreview.data ?? []).map((c) => (
                    <tr key={c.row.id} className="border-t border-border">
                      <td className="px-2 py-1">{fmtDay(c.row.schedule_date)}</td>
                      <td className="px-2 py-1 font-mono">{plateOf(c.row.vehicle_id)}</td>
                      <td className="px-2 py-1">{[c.row.external_place, ...(c.row.extra_places ?? [])].filter(Boolean).join(", ")}</td>
                      <td className="px-2 py-1 text-right">{Number(c.row.km)} → {c.km}</td>
                      <td className="px-2 py-1 text-right">{Number(c.row.extra_km ?? 0)} → {c.extra_km}</td>
                      <td className="px-2 py-1 text-right">{c.row.place_toll ?? "—"} → {c.place_toll ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecalcOpen(false)}>Cancelar</Button>
            <Button onClick={() => applyRecalc.mutate()} disabled={applyRecalc.isPending || recalcPreview.isFetching || !(recalcPreview.data ?? []).length}>
              {applyRecalc.isPending ? "Gravando…" : `Gravar ${(recalcPreview.data ?? []).length} dia(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

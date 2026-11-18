import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  GripVertical,
  Search,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SearchSelect } from "@/components/search-select";
import { IndustryCustomerSelect, industryKmOneWay, industryToll, useIndustryCustomers } from "@/components/industry-customer-select";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const EXTERNAL_KEY = "__external__";
export const MAINTENANCE_KEY = "__maintenance__";
export const SUZANO_LOCAL_KEY = "__suzano_local__";
export const KM_SUZANO_LOCAL = 6;
export const KM_WORK = 50;
export const KM_EXTERNAL = 100;
/** A logística por clientes Indústria (km de ida e pedágio do cadastro) vale a partir desta data. */
export const LOGISTICS_START = "2026-10-26";

export type VehicleScheduleRow = {
  id: string;
  schedule_date: string;
  vehicle_id: string;
  driver_id: string | null;
  client_id: string | null;
  is_external: boolean;
  is_maintenance: boolean;
  driver_bonus: boolean;
  km: number;
  extra_client_ids?: string[];
  extra_driver_ids?: string[];
  /** Caminhão/pickup: quem pediu o frete (Solicitante) e se o Motorista foi marcado; driver_id = motorista que vale (o marcado, senão o solicitante). */
  requester_id?: string | null;
  driver_toggle?: boolean;
  extra_requester_ids?: string[];
  extra_driver_toggles?: boolean[];
  /** Local digitado por obra adicional (Indústria = viagem fora); mesma posição de extra_client_ids. */
  extra_places?: string[];
  /** Serviço de cada obra adicional (caminhão/pickup); vazio = rateio do cliente. Mesma posição de extra_client_ids. */
  extra_work_ids?: string[];
  extra_km?: number;
  trips?: number;
  is_suzano_local?: boolean;
  work_id?: string | null;
  external_place?: string | null;
};

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

function shortName(full: string) {
  return full.trim().split(/\s+/).slice(0, 2).join(" ");
}

function isWeekend(iso: string) {
  const d = new Date(`${iso}T00:00:00`).getDay();
  return d === 0 || d === 6;
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

type CellForm = {
  driver_id: string;
  client_id: string;
  driver_bonus: boolean;
  repeat_until: string;
  extras: string[];
  extraDrivers: string[];
  extraPlaces: string[];
  extraWorks: string[];
  trips: string;
  external_place: string;
  /** Km de ida digitado (só cliente ADM). */
  km: string;
  /** Caminhão/pickup: Solicitante e toggle Motorista (driver_id = motorista marcado; NONE = Definir). */
  requester_id: string;
  driver_toggle: boolean;
  extraRequesters: string[];
  extraToggles: boolean[];
};

const NONE = "__none__";
const WORK_PREFIX = "w:";
const ALL_WORKS = "__all_works__";
const SPECIAL_KEYS = new Set([EXTERNAL_KEY, MAINTENANCE_KEY, SUZANO_LOCAL_KEY]);

export function VehicleTimeline() {
  const { canWrite } = useCurrentUser();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(monthKeyNow);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [cell, setCell] = useState<{ vehicleId: string; date: string } | null>(null);
  const [form, setForm] = useState<CellForm>({ driver_id: NONE, client_id: NONE, driver_bonus: false, repeat_until: "", extras: [], extraDrivers: [], extraPlaces: [], extraWorks: [], trips: "1", external_place: "", km: "", requester_id: NONE, driver_toggle: false, extraRequesters: [], extraToggles: [] });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyStart, setCopyStart] = useState("");
  const [copyEnd, setCopyEnd] = useState("");
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
    const saved = sessionStorage.getItem(SCROLL_KEY);
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
    queryKey: ["timeline-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name")
        .eq("is_driver", true)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

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
        .select("id, schedule_date, vehicle_id, driver_id, client_id, is_external, is_maintenance, driver_bonus, km, extra_client_ids, extra_driver_ids, extra_places, extra_work_ids, extra_km, trips, is_suzano_local, work_id, external_place, requester_id, driver_toggle, extra_requester_ids, extra_driver_toggles")
        .gte("schedule_date", days[0]!)
        .lte("schedule_date", days[days.length - 1]!);
      if (error) throw error;
      return (data ?? []) as VehicleScheduleRow[];
    },
    enabled: days.length > 0,
  });

  const byCell = useMemo(() => {
    const map = new Map<string, VehicleScheduleRow>();
    (schedules.data ?? []).forEach((s) => map.set(`${s.vehicle_id}|${s.schedule_date}`, s));
    return map;
  }, [schedules.data]);

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

  // O KM exibido é apenas a distância de ida cadastrada no cliente.
  const worksQ = useQuery({
    queryKey: ["vehicle-timeline-works"],
    queryFn: async () => {
      const { data } = await supabase.from("works").select("id, name, client_id, clients(name)").eq("active", true).order("name");
      return (data ?? []) as { id: string; name: string; client_id: string | null; clients: { name: string } | null }[];
    },
  });
  const workById = useMemo(() => new Map((worksQ.data ?? []).map((w) => [w.id, w])), [worksQ.data]);
  const workLabel = (id: string) => {
    const w = workById.get(id);
    return w ? `${w.clients?.name ? `${w.clients.name} - ` : ""}${w.name}` : "—";
  };
  const byWorkVehicle = (vehicleId: string) =>
    !!(vehicles.data ?? []).find((v: any) => v.id === vehicleId)?.assign_by_work;

  // Indústria com local escrito (antigo "Externo"): 100 km fixos no dia e sem prêmio de motorista.
  const industryIds = useMemo(() => new Set((clients.data ?? []).filter((c) => /ind[uú]stria/i.test(c.name ?? "")).map((c) => c.id)), [clients.data]);
  const isIndustryClient = (id: string | null | undefined) => !!id && industryIds.has(id);
  // ADM: o km do dia é digitado na escala (vale para o Prêmio Motorista), não vem da distância do cliente.
  const admIds = useMemo(() => new Set((clients.data ?? []).filter((c) => /^adm$/i.test((c.name ?? "").trim())).map((c) => c.id)), [clients.data]);
  const isAdmClient = (id: string | null | undefined) => !!id && admIds.has(id);

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

  const upsert = useMutation({
    mutationFn: async (rows: Omit<VehicleScheduleRow, "id">[]) => {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("vehicle_schedules")
        .upsert(rows, { onConflict: "schedule_date,vehicle_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["km-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicle_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["km-report"] });
      toast.success("Programação removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Local da Indústria: km de ida do cadastro de clientes Indústria; sem km preenchido, os 100 km de antes.
  const placeKmOneWay = (place: string) => industryKmOneWay(industryCustomers.data, place) ?? KM_EXTERNAL;
  const placeExtraKm = (place: string) => { const k = industryKmOneWay(industryCustomers.data, place); return k != null ? k * 2 : KM_EXTERNAL; };

  function extraKm(id: string) {
    if (id === EXTERNAL_KEY) return KM_EXTERNAL;
    if (id === MAINTENANCE_KEY) return 0;
    if (id === SUZANO_LOCAL_KEY) return KM_SUZANO_LOCAL;
    return clientKm.get(id) ?? 0;
  }

  function extraName(id: string, place?: string | null) {
    // Indústria com local digitado (viagem fora): aparece só o local, como era o Externo.
    if (place && isIndustryClient(id)) return place.toUpperCase();
    if (id === EXTERNAL_KEY) return "EXTERNO";
    if (id === MAINTENANCE_KEY) return "MANUTENÇÃO";
    if (id === SUZANO_LOCAL_KEY) return "SUZANO LOCAL";
    return clientName.get(id) ?? "—";
  }

  function clientOptions() {
    const list = clients.data ?? [];
    let idx = list.findIndex((c) => /^suzano$/i.test((c.name ?? "").trim()));
    if (idx < 0) idx = list.findIndex((c) => /suzano/i.test(c.name ?? ""));
    const out: ReactNode[] = [];
    list.forEach((c, i) => {
      out.push(<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>);
      if (i === idx) out.push(<SelectItem key={SUZANO_LOCAL_KEY} value={SUZANO_LOCAL_KEY}>SUZANO LOCAL</SelectItem>);
    });
    if (idx < 0) out.push(<SelectItem key={SUZANO_LOCAL_KEY} value={SUZANO_LOCAL_KEY}>SUZANO LOCAL</SelectItem>);
    return out;
  }

  function buildRow(
    vehicleId: string,
    date: string,
    f: {
      driver_id: string | null;
      client_id: string | null;
      is_external: boolean;
      is_maintenance: boolean;
      driver_bonus: boolean;
      extra_client_ids?: string[] | undefined;
      extra_driver_ids?: string[] | undefined;
      extra_places?: string[] | undefined;
      extra_work_ids?: string[] | undefined;
      trips?: number | undefined;
      is_suzano_local?: boolean | undefined;
      work_id?: string | null | undefined;
      external_place?: string | null | undefined;
      km?: number | null | undefined;
      requester_id?: string | null | undefined;
      driver_toggle?: boolean | undefined;
      extra_requester_ids?: string[] | undefined;
      extra_driver_toggles?: boolean[] | undefined;
    },
  ) {
    const workId = f.work_id ?? null;
    if (workId) f = { ...f, client_id: workById.get(workId)?.client_id ?? f.client_id };
    const special = f.is_external || f.is_maintenance || !!f.is_suzano_local;
    const industryPlace = !special && isIndustryClient(f.client_id) ? (f.external_place ?? "").trim() : "";
    const pairs = (f.extra_client_ids ?? [])
          .map((c, i) => ({ c, d: f.extra_driver_ids?.[i] ?? "", place: isIndustryClient(c) ? (f.extra_places?.[i] ?? "").trim() : "", w: f.extra_work_ids?.[i] ?? "",
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
      extra_km: pairs.reduce((s, p) => s + (p.place ? placeExtraKm(p.place) : extraKm(p.c)), 0),
      work_id: special ? null : workId,
      external_place: f.is_external ? (f.external_place ?? "").trim() || null : industryPlace || null,
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
    setForm({
      requester_id: bw ? req : NONE,
      driver_toggle: bw ? !!current?.driver_toggle : false,
      extraRequesters: bw ? extraReq : (current?.extra_client_ids ?? []).map(() => NONE),
      extraToggles: (current?.extra_client_ids ?? []).map((_, i) => bw && !!current?.extra_driver_toggles?.[i]),
      driver_id: bw ? chosen(current?.driver_id, req, !!current?.driver_toggle) : current?.driver_id ?? NONE,
      client_id: current
        ? current.is_maintenance
          ? MAINTENANCE_KEY
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
      extras: [...(current?.extra_client_ids ?? [])],
      extraDrivers: (current?.extra_client_ids ?? []).map((_, i) => bw
        ? chosen(current?.extra_driver_ids?.[i], extraReq[i]!, !!current?.extra_driver_toggles?.[i])
        : current?.extra_driver_ids?.[i] || NONE),
      extraPlaces: (current?.extra_client_ids ?? []).map((_, i) => current?.extra_places?.[i] ?? ""),
      extraWorks: (current?.extra_client_ids ?? []).map((_, i) => current?.extra_work_ids?.[i] ?? ""),
      trips: String(current?.trips ?? 1),
      external_place: current?.external_place ?? "",
      km: current && isAdmClient(current.client_id) ? String(current.km ?? "") : "",
    });
    setDriverSearch("");
    setCell({ vehicleId, date });
  }

  function saveCell() {
    if (!cell) return;
    if (form.client_id === NONE) {
      toast.error("Selecione a obra/cliente ou MANUTENÇÃO.");
      return;
    }
    const isExternal = form.client_id === EXTERNAL_KEY;
    const isMaintenance = form.client_id === MAINTENANCE_KEY;
    const isLocal = form.client_id === SUZANO_LOCAL_KEY;
    const workId = form.client_id.startsWith(WORK_PREFIX) ? form.client_id.slice(WORK_PREFIX.length) : null;
    // Caminhão/pickup: o motorista que vale (prêmio, CNH, ranking) é o marcado no toggle; sem ele, o solicitante.
    const bw = byWorkVehicle(cell.vehicleId);
    const eff = (on: boolean, d: string, r: string) => (bw ? (on && d !== NONE ? d : r) : d);
    const mainDriver = eff(form.driver_toggle, form.driver_id, form.requester_id);
    const base = {
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
      driver_bonus: form.driver_bonus,
      extra_client_ids: form.extras,
      extra_driver_ids: form.extras.map((_, i) => eff(!!form.extraToggles[i], form.extraDrivers[i] ?? NONE, form.extraRequesters[i] ?? NONE)),
      extra_places: form.extraPlaces,
      extra_work_ids: form.extraWorks,
      external_place: form.external_place,
      km: form.km.trim() === "" ? null : Number(form.km.replace(",", ".")),
    };
    const targets: string[] = [cell.date];
    if (form.repeat_until && form.repeat_until > cell.date) {
      let d = addDays(cell.date, 1);
      while (d <= form.repeat_until) {
        targets.push(d);
        d = addDays(d, 1);
      }
    }
    upsert.mutate(targets.map((d) => buildRow(cell.vehicleId, d, base)));
    setCell(null);
  }

  function onDrop(vehicleId: string, date: string, payload: string) {
    if (!canWrite) return;
    try {
      const src = JSON.parse(payload) as VehicleScheduleRow;
      upsert.mutate([
        buildRow(vehicleId, date, {
          driver_id: src.driver_id,
          client_id: src.client_id,
          is_external: src.is_external,
          is_maintenance: src.is_maintenance ?? false,
          driver_bonus: src.driver_bonus,
          extra_client_ids: src.extra_client_ids,
          extra_driver_ids: src.extra_driver_ids,
          extra_places: src.extra_places,
          extra_work_ids: src.extra_work_ids,
          trips: src.trips,
          is_suzano_local: src.is_suzano_local,
          work_id: src.work_id,
          external_place: src.external_place,
          km: src.km,
          requester_id: src.requester_id, driver_toggle: src.driver_toggle, extra_requester_ids: src.extra_requester_ids, extra_driver_toggles: src.extra_driver_toggles,
        }),
      ]);
    } catch {
      /* ignore */
    }
  }

  function runCopyDay() {
    if (!copyFrom || !copyStart) {
      toast.error("Informe a data de origem e o destino.");
      return;
    }
    const source = (schedules.data ?? []).filter((s) => s.schedule_date === copyFrom);
    if (source.length === 0) {
      toast.error("Não há programação na data de origem.");
      return;
    }
    const end = copyEnd && copyEnd >= copyStart ? copyEnd : copyStart;
    const rows: Omit<VehicleScheduleRow, "id">[] = [];
    let d = copyStart;
    while (d <= end) {
      for (const s of source) {
        rows.push(
          buildRow(s.vehicle_id, d, {
            driver_id: s.driver_id,
            client_id: s.client_id,
            is_external: s.is_external,
            is_maintenance: s.is_maintenance ?? false,
            driver_bonus: s.driver_bonus,
            extra_client_ids: s.extra_client_ids,
            extra_driver_ids: s.extra_driver_ids,
            extra_places: s.extra_places,
            extra_work_ids: s.extra_work_ids,
            trips: s.trips,
            is_suzano_local: s.is_suzano_local,
            work_id: s.work_id,
            external_place: s.external_place,
            km: s.km,
            requester_id: s.requester_id, driver_toggle: s.driver_toggle, extra_requester_ids: s.extra_requester_ids, extra_driver_toggles: s.extra_driver_toggles,
          }),
        );
      }
      d = addDays(d, 1);
    }
    upsert.mutate(rows);
    toast.success(`${rows.length} programações copiadas.`);
    setCopyOpen(false);
  }

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
            .select("collaborator_id, works(client_id)")
            .eq("schedule_id", sched.id),
        ]);
        const unavailable = new Set<string>();
        [vacations.data, leaves.data, daysOff.data, appts.data].forEach((list) =>
          (list ?? []).forEach((r) => unavailable.add(r.collaborator_id)),
        );
        (allocs.data ?? []).forEach((a) => {
          if (unavailable.has(a.collaborator_id)) return;
          const cid = (a as unknown as { works: { client_id: string | null } | null }).works?.client_id;
          if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
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

  // Clientes Indústria valem desde LOGISTICS_START: os dias com local já lançados são recalculados (km, km extra e
  // pedágio) sempre que o cadastro muda; só grava o que ficou diferente. Locais sem cadastro seguem com 100 km.
  const placesSig = (industryCustomers.data ?? []).map((c) => `${c.name}|${c.km_one_way}|${c.has_toll}|${c.toll_amount}`).join(";");
  const placesDone = useRef("");
  useEffect(() => {
    if (!canWrite || !industryCustomers.data?.length || !clients.data || !worksQ.data || placesDone.current === placesSig) return;
    placesDone.current = placesSig;
    void (async () => {
      const { data, error } = await supabase.from("vehicle_schedules")
        .select("id, schedule_date, vehicle_id, driver_id, client_id, is_external, is_maintenance, driver_bonus, km, extra_client_ids, extra_driver_ids, extra_places, extra_km, trips, is_suzano_local, work_id, external_place, place_toll")
        .gte("schedule_date", LOGISTICS_START).or("external_place.not.is.null,extra_places.neq.{}");
      if (error || !data) return;
      let changed = 0;
      for (const s of data as (VehicleScheduleRow & { place_toll: number | null })[]) {
        if (s.is_external) continue;
        // Só mexe nos dias com algum local cadastrado; o resto fica como foi lançado.
        if (![s.external_place, ...(s.extra_places ?? [])].some((p) => p && industryKmOneWay(industryCustomers.data, p) != null || (p && industryToll(industryCustomers.data, p) != null))) continue;
        const b = buildRow(s.vehicle_id, s.schedule_date, { ...s, trips: s.trips ?? 1 });
        const same = (x: number | null | undefined, y: number | null | undefined) => (x == null && y == null) || Number(x) === Number(y);
        if (same(b.km, s.km) && same(b.extra_km, s.extra_km) && same(b.place_toll, s.place_toll)) continue;
        const { error: e } = await supabase.from("vehicle_schedules").update({ km: b.km, extra_km: b.extra_km, place_toll: b.place_toll }).eq("id", s.id);
        if (!e) changed++;
      }
      if (changed) {
        queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
        queryClient.invalidateQueries({ queryKey: ["km-report"] });
        toast.success(`Km/pedágio de ${changed} dia(s) desde ${LOGISTICS_START.split("-").reverse().join("/")} atualizados pelo cadastro de clientes Indústria`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, placesSig, clients.data, worksQ.data]);

  // Caminhão (atribuído por serviço): cliente escolhido, vindo do serviço quando há um.
  const byWork = !!cell && byWorkVehicle(cell.vehicleId);
  const truckClient = form.client_id.startsWith(WORK_PREFIX) ? workById.get(form.client_id.slice(WORK_PREFIX.length))?.client_id ?? NONE : form.client_id;
  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    return (drivers.data ?? []).filter((d) => !q || d.full_name.toLowerCase().includes(q));
  }, [drivers.data, driverSearch]);

  // ---- Fretes do dia no editor: o principal (form.client_id/driver_id/external_place) + obras adicionais, como uma lista ----
  type Freight = { client: string; driver: string; place: string; requester: string; toggle: boolean };
  function getFreights(f: CellForm): Freight[] {
    const main: Freight = { client: f.client_id, driver: f.driver_id, place: f.external_place, requester: f.requester_id, toggle: f.driver_toggle };
    const extras = f.extras.map((c, i) => ({ client: f.extraWorks[i] ? WORK_PREFIX + f.extraWorks[i] : c, driver: f.extraDrivers[i] ?? NONE, place: f.extraPlaces[i] ?? "",
      requester: f.extraRequesters[i] ?? NONE, toggle: !!f.extraToggles[i] }));
    return [main, ...extras];
  }
  function setFreights(f: CellForm, list: Freight[]): CellForm {
    const [main, ...rest] = list.length ? list : [{ client: NONE, driver: NONE, place: "", requester: NONE, toggle: false }];
    const baseOf = (c: string) => (c.startsWith(WORK_PREFIX) ? workById.get(c.slice(WORK_PREFIX.length))?.client_id ?? NONE : c);
    return {
      ...f,
      client_id: main!.client, driver_id: main!.driver, external_place: main!.place, requester_id: main!.requester, driver_toggle: main!.toggle,
      extraRequesters: rest.map((x) => x.requester),
      extraToggles: rest.map((x) => x.toggle),
      // O km digitado (ADM) é do frete principal: some se outro frete passar a ser o principal.
      km: main!.client === f.client_id ? f.km : "",
      extras: rest.map((x) => baseOf(x.client)),
      extraWorks: rest.map((x) => (x.client.startsWith(WORK_PREFIX) ? x.client.slice(WORK_PREFIX.length) : "")),
      extraDrivers: rest.map((x) => x.driver),
      extraPlaces: rest.map((x) => x.place),
    };
  }
  const patchFreight = (i: number, patch: Partial<Freight>) => setForm((f) => setFreights(f, getFreights(f).map((x, j) => (j === i ? { ...x, ...patch } : x))));
  const [dragFreight, setDragFreight] = useState<number | null>(null);
  const moveFreight = (from: number, to: number) => setForm((f) => {
    const list = getFreights(f);
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    return setFreights(f, list);
  });
  // Toggle Motorista ligado e ainda em "Definir" (sem motorista escolhido, ou igual ao solicitante) em algum frete do dia.
  const driverUndefined = (r: VehicleScheduleRow) =>
    (!!r.driver_toggle && (!r.driver_id || r.driver_id === r.requester_id))
    || (r.extra_client_ids ?? []).some((_, i) => !!r.extra_driver_toggles?.[i] && (!r.extra_driver_ids?.[i] || r.extra_driver_ids[i] === r.extra_requester_ids?.[i]));
  const driverOptions = useMemo(() => [{ value: NONE, label: "Sem motorista" }, ...(drivers.data ?? []).map((d) => ({ value: d.id, label: d.full_name }))], [drivers.data]);
  const requesterOptions = useMemo(() => [{ value: NONE, label: "Sem solicitante" }, ...(drivers.data ?? []).map((d) => ({ value: d.id, label: d.full_name }))], [drivers.data]);
  const pickDriverOptions = useMemo(() => [{ value: NONE, label: "Definir" }, ...(drivers.data ?? []).map((d) => ({ value: d.id, label: d.full_name }))], [drivers.data]);

  function freightKmText(fr: Freight, i: number) {
    const base = fr.client.startsWith(WORK_PREFIX) ? workById.get(fr.client.slice(WORK_PREFIX.length))?.client_id ?? "" : fr.client;
    if (fr.client === NONE) return "";
    if (fr.client === MAINTENANCE_KEY) return "Manutenção: 0 km no dia, sem prêmio de motorista e sem prêmio de viagem.";
    if (fr.client === SUZANO_LOCAL_KEY) return `Suzano Local: ${KM_SUZANO_LOCAL} km de ida por viagem (${KM_SUZANO_LOCAL * 2} km ida e volta).`;
    if (fr.client === EXTERNAL_KEY) return `Externo: ${KM_EXTERNAL} km no dia, sem prêmio de motorista e sem prêmio de viagem.`;
    if (isAdmClient(base)) return i === 0 ? "ADM: digite o km de ida do dia; é ele que define a faixa do Prêmio Motorista." : `${extraKm(base)} km (ADM)`;
    if (isIndustryClient(base) && fr.place.trim()) {
      const known = industryKmOneWay(industryCustomers.data, fr.place) != null;
      return i === 0
        ? `Indústria com local: ${known ? `${placeKmOneWay(fr.place)} km de ida (× 2)` : `${KM_EXTERNAL} km (local sem km cadastrado)`}, sem prêmio de motorista. O combustível vai para o CC da Indústria.`
        : `${placeExtraKm(fr.place.trim())} km`;
    }
    return i === 0 ? `${clientKm.get(base) ?? 0} km no dia (distância cadastrada do cliente).` : `${extraKm(base)} km`;
  }

  function renderFreight(fr: Freight, i: number, total: number) {
    const base = fr.client.startsWith(WORK_PREFIX) ? workById.get(fr.client.slice(WORK_PREFIX.length))?.client_id ?? NONE : fr.client;
    return (
      <div key={i}
        onDragOver={(e) => { if (dragFreight !== null) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragFreight !== null && dragFreight !== i) moveFreight(dragFreight, i); setDragFreight(null); }}
        className={`space-y-2 rounded-md border p-2.5 ${dragFreight === i ? "border-primary opacity-60" : "border-border"}`}>
        <div className="flex items-center gap-2">
          {total > 1 && (
            <span draggable onDragStart={(e) => { setDragFreight(i); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragFreight(null)}
              className="cursor-grab text-muted-foreground active:cursor-grabbing" title="Arraste para mudar a ordem" aria-label="Arrastar frete">
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <span className="text-sm font-semibold">Frete {i + 1}{i === 0 && total > 1 ? " (principal)" : ""}</span>
          {total > 1 && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-destructive" title="Excluir este frete"
              onClick={() => setForm((f) => setFreights(f, getFreights(f).filter((_, j) => j !== i)))}>
              <Trash2 className="h-3.5 w-3.5" /> Excluir frete
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
        {byWork ? (
          <div className="space-y-1">
            <Label>Solicitante</Label>
            <SearchSelect value={fr.requester} onChange={(v) => patchFreight(i, { requester: v })} options={requesterOptions} placeholder="Selecione o solicitante" searchPlaceholder="Buscar solicitante" />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>Motorista</Label>
            <SearchSelect value={fr.driver} onChange={(v) => patchFreight(i, { driver: v })} options={driverOptions} placeholder="Selecione o motorista" searchPlaceholder="Buscar motorista" />
          </div>
        )}
        <div className="space-y-1">
          <Label>{byWork ? "Cliente" : "Obra / Cliente"}</Label>
          {/* Caminhão: primeiro o cliente, depois (opcional) o serviço. Só o cliente = rateio pelas horas dos serviços dele. */}
          <Select value={byWork ? base : fr.client} onValueChange={(v) => patchFreight(i, { client: v, place: "" })}>
            <SelectTrigger><SelectValue placeholder={byWork ? "Selecione o cliente" : "Selecione a obra"} /></SelectTrigger>
            <SelectContent>
              {clientOptions()}
              <SelectItem value={MAINTENANCE_KEY}>MANUTENÇÃO</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {byWork && base !== NONE && !SPECIAL_KEYS.has(base) && (
          <div className="space-y-1">
            <Label>Serviço</Label>
            <Select value={fr.client.startsWith(WORK_PREFIX) ? fr.client : ALL_WORKS} onValueChange={(v) => patchFreight(i, { client: v === ALL_WORKS ? base : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_WORKS}>Todos os serviços do cliente (rateio por horas)</SelectItem>
                {(worksQ.data ?? []).filter((w) => w.client_id === base).map((w) => (
                  <SelectItem key={w.id} value={WORK_PREFIX + w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {(fr.client === EXTERNAL_KEY || isIndustryClient(base)) && (
          <div className="space-y-1">
            <Label>Local</Label>
            {byWork && fr.client !== EXTERNAL_KEY
              ? <IndustryCustomerSelect value={fr.place} onChange={(name) => patchFreight(i, { place: name })} />
              : <Input placeholder="Ex.: Campinas, São Paulo, Bahia" value={fr.place} onChange={(e) => patchFreight(i, { place: e.target.value })} />}
          </div>
        )}
        {i === 0 && isAdmClient(base) && (
          <div className="space-y-1">
            <Label htmlFor="vehicle-adm-km">Km do dia (ida)</Label>
            <Input id="vehicle-adm-km" inputMode="decimal" placeholder="Ex.: 35" value={form.km}
              onChange={(e) => setForm((f) => ({ ...f, km: e.target.value.replace(/[^\d,.]/g, "") }))} />
          </div>
        )}
        {/* Caminhão/pickup: toggle Motorista embaixo dos seletores; ligado, a lista fica na 2ª coluna. */}
        {byWork && (
          <div className="flex min-h-10 items-center gap-2 sm:col-start-1">
            <Switch id={`freight-driver-${i}`} checked={fr.toggle} onCheckedChange={(v) => patchFreight(i, { toggle: v, driver: v ? fr.driver : NONE })} />
            <Label htmlFor={`freight-driver-${i}`}>Motorista</Label>
            {!fr.toggle && <span className="text-xs text-muted-foreground">(sem marcar, vale o solicitante)</span>}
          </div>
        )}
        {byWork && fr.toggle && (
          <SearchSelect value={fr.driver} onChange={(v) => patchFreight(i, { driver: v })} options={pickDriverOptions} placeholder="Definir" searchPlaceholder="Buscar motorista" />
        )}
        </div>
        <p className="text-xs text-muted-foreground">{freightKmText(fr, i) || "A quilometragem vem da distância cadastrada do cliente."}</p>
        {byWork && i === 0 && base !== NONE && !SPECIAL_KEYS.has(base) && !fr.client.startsWith(WORK_PREFIX) && (
          <p className="text-xs text-muted-foreground">O custo do caminhão no dia é dividido entre os serviços do cliente pelas horas trabalhadas em cada um.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="relative min-w-[200px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar modelo ou placa"
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <Filter className="h-4 w-4" /> Veículos
              {hidden.size > 0 && <Badge variant="secondary">{hidden.size} ocultos</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-h-80 w-72 overflow-y-auto">
            <p className="mb-2 text-xs text-muted-foreground">Marque os veículos exibidos na timeline.</p>
            <div className="space-y-2">
              {orderedVehicles.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!hidden.has(v.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(hidden);
                      if (checked) next.delete(v.id);
                      else next.add(v.id);
                      savePrefs.mutate({ hidden: [...next] });
                    }}
                  />
                  <span className="truncate">
                    {[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"} · {v.plate}
                  </span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="outline" onClick={() => setCopyOpen(true)} disabled={!canWrite}>
          <Copy className="h-4 w-4" /> Copiar dia
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
                {days.map((d) => {
                  const row = byCell.get(`${v.id}|${d}`);
                  return (
                    <td
                      key={d}
                      className={`w-24 min-w-24 border-b border-r border-border p-0 align-middle ${isWeekend(d) ? "bg-muted/40" : ""}`}
                      onDragOver={(e) => {
                        if (canWrite) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        onDrop(v.id, d, e.dataTransfer.getData("text/plain"));
                      }}
                    >
                      <button
                        type="button"
                        draggable={!!row && canWrite}
                        onDragStart={(e) => row && e.dataTransfer.setData("text/plain", JSON.stringify(row))}
                        onClick={() => openCell(v.id, d)}
                        className="h-9 w-full cursor-pointer px-1 text-left leading-tight hover:bg-accent/40"
                      >
                        {row ? (
                          <>
                            <div className="flex items-center gap-1">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.driver_bonus ? "bg-success" : "bg-muted-foreground/40"}`}
                                title={row.driver_bonus ? "Com prêmio de motorista" : "Sem prêmio de motorista"}
                              />
                              <span className="truncate text-[10px] font-medium">
                                {row.driver_id ? shortName(driverName.get(row.driver_id) ?? "—") : "Sem motorista"}
                              </span>
                              {driverUndefined(row) && (
                                <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" title="Motorista a definir" aria-label="Motorista a definir" />
                              )}
                            </div>
                            <div
                              className="truncate text-[10px] uppercase text-muted-foreground"
                              title={
                                (row.extra_client_ids ?? []).length
                                  ? `+ ${(row.extra_client_ids ?? []).map((id, i) => { const dr = row.extra_driver_ids?.[i]; return `${extraName(id, row.extra_places?.[i])}${dr ? ` (${driverName.get(dr) ?? "—"})` : ""}`; }).join(", ")}`
                                  : undefined
                              }
                            >
                              {Number(row.km) + Number(row.extra_km ?? 0)}km{" "}
                              {row.is_maintenance
                                ? "MANUTENÇÃO"
                                : row.is_external
                                  ? (row.external_place || "EXTERNO").toUpperCase()
                                  : row.is_suzano_local
                                    ? "SUZANO LOCAL"
                                  : row.external_place && isIndustryClient(row.client_id)
                                    ? row.external_place.toUpperCase()
                                  : clientName.get(row.client_id ?? "") ?? "—"}
                              {(row.extra_client_ids ?? []).length > 0 && (
                                <span className="font-semibold text-primary"> +{row.extra_client_ids!.length}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/60">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      {/* Editor da célula */}
      <Dialog open={!!cell} onOpenChange={(o) => !o && setCell(null)}>
        <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Programação do veículo</DialogTitle>
          </DialogHeader>
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
            {/* Cada frete do dia é uma caixa igual (motorista, cliente, serviço, local, km); o 1º é o principal.
                Dá para excluir qualquer um e arrastar pela alça para mudar a ordem. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Fretes do dia</Label>
                <Button variant="outline" size="sm" onClick={() => setForm((f) => setFreights(f, [...getFreights(f), byWork
                  ? { client: NONE, driver: NONE, place: "", requester: f.requester_id, toggle: false }
                  : { client: NONE, driver: f.driver_id, place: "", requester: NONE, toggle: false }]))}>
                  <Plus className="h-4 w-4" /> Adicionar frete
                </Button>
              </div>
              {getFreights(form).map((fr, i, list) => renderFreight(fr, i, list.length))}
              {getFreights(form).length > 1 && (
                <p className="text-xs text-muted-foreground">O 1º frete é o principal (prêmios e viagens); o km dos outros é somado no relatório da frota.</p>
              )}
            </div>
            <div className="grid gap-3 rounded-md border border-border p-2.5 sm:grid-cols-3">
              <div className="space-y-1" title="Na 1ª viagem vai a lotação cheia; nas seguintes, uma pessoa a menos (ex.: Suzano, 6 e 5).">
                <Label htmlFor="vehicle-trips">Viagens no dia</Label>
                <Input id="vehicle-trips" type="number" min={1} step="1" value={form.trips} onChange={(e) => setForm((f) => ({ ...f, trips: e.target.value }))} />
              </div>
              <div className="space-y-1" title="Verde = recebe · Cinza = não recebe">
                <Label className="block">Prêmio de Motorista</Label>
                <div className="flex h-10 items-center">
                  <Switch
                    checked={form.driver_bonus && form.client_id !== EXTERNAL_KEY && form.client_id !== MAINTENANCE_KEY && !(isIndustryClient(truckClient) && form.external_place.trim())}
                    disabled={form.client_id === EXTERNAL_KEY || form.client_id === MAINTENANCE_KEY || (isIndustryClient(truckClient) && !!form.external_place.trim())}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, driver_bonus: v }))}
                  />
                </div>
              </div>
              <div className="space-y-1" title="Aplica a mesma programação nos dias seguintes até a data escolhida.">
                <Label htmlFor="vehicle-repeat">Repetir até (opcional)</Label>
                <Input id="vehicle-repeat" type="date" value={form.repeat_until} onChange={(e) => setForm((f) => ({ ...f, repeat_until: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                const row = cell && byCell.get(`${cell.vehicleId}|${cell.date}`);
                if (row) remove.mutate(row.id);
                setCell(null);
              }}
              disabled={!cell || !byCell.get(`${cell.vehicleId}|${cell.date}`)}
            >
              <Trash2 className="h-4 w-4 text-destructive" /> Remover
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCell(null)}>Cancelar</Button>
              <Button onClick={saveCell} disabled={upsert.isPending}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            </div>
            <div className="space-y-1">
              <Label>Para (início)</Label>
              <Input type="date" value={copyStart} onChange={(e) => setCopyStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Para (fim, opcional)</Label>
              <Input type="date" value={copyEnd} onChange={(e) => setCopyEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>Cancelar</Button>
            <Button onClick={runCopyDay}>Copiar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Filter,
  Search,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
export const KM_WORK = 100;
export const KM_EXTERNAL = 200;

export type VehicleScheduleRow = {
  id: string;
  schedule_date: string;
  vehicle_id: string;
  driver_id: string | null;
  client_id: string | null;
  is_external: boolean;
  driver_bonus: boolean;
  km: number;
};

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function monthKeyNow() {
  return new Date().toISOString().slice(0, 7);
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
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
};

const NONE = "__none__";

export function VehicleTimeline() {
  const { canWrite } = useCurrentUser();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(monthKeyNow);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [cell, setCell] = useState<{ vehicleId: string; date: string } | null>(null);
  const [form, setForm] = useState<CellForm>({ driver_id: NONE, client_id: NONE, driver_bonus: false, repeat_until: "" });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyStart, setCopyStart] = useState("");
  const [copyEnd, setCopyEnd] = useState("");
  const [needsDate, setNeedsDate] = useState(() => new Date().toISOString().slice(0, 10));

  const days = useMemo(() => monthDays(month), [month]);

  const vehicles = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("plate");
      if (error) throw error;
      return data;
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
        .select("id, name, distance_km, needs_company_transport, needs_transport_voucher")
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
        .select("id, schedule_date, vehicle_id, driver_id, client_id, is_external, driver_bonus, km")
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

  const clientKm = useMemo(() => {
    const map = new Map<string, number>();
    (clients.data ?? []).forEach((c) => {
      const isIndustry = /ind[uú]stria/i.test(c.name ?? "");
      map.set(c.id, isIndustry ? KM_WORK : Number(c.distance_km ?? 0) || 0);
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

  function moveVehicle(vehicleId: string, delta: number) {
    const ids = orderedVehicles.map((v) => v.id);
    const from = ids.indexOf(vehicleId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
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

  function buildRow(vehicleId: string, date: string, f: { driver_id: string | null; client_id: string | null; is_external: boolean; driver_bonus: boolean }) {
    return {
      schedule_date: date,
      vehicle_id: vehicleId,
      driver_id: f.driver_id,
      client_id: f.is_external ? null : f.client_id,
      is_external: f.is_external,
      driver_bonus: f.is_external ? false : f.driver_bonus,
      km: f.is_external ? KM_EXTERNAL : (f.client_id ? clientKm.get(f.client_id) ?? 0 : 0),
    };
  }

  function openCell(vehicleId: string, date: string) {
    if (!canWrite) return;
    const current = byCell.get(`${vehicleId}|${date}`);
    setForm({
      driver_id: current?.driver_id ?? NONE,
      client_id: current ? (current.is_external ? EXTERNAL_KEY : current.client_id ?? NONE) : NONE,
      driver_bonus: current?.driver_bonus ?? false,
      repeat_until: "",
    });
    setDriverSearch("");
    setCell({ vehicleId, date });
  }

  function saveCell() {
    if (!cell) return;
    if (form.client_id === NONE) {
      toast.error("Selecione a obra/cliente ou EXTERNO.");
      return;
    }
    const isExternal = form.client_id === EXTERNAL_KEY;
    const base = {
      driver_id: form.driver_id === NONE ? null : form.driver_id,
      client_id: isExternal ? null : form.client_id,
      is_external: isExternal,
      driver_bonus: form.driver_bonus,
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
          driver_bonus: src.driver_bonus,
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
            driver_bonus: s.driver_bonus,
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
        const { data } = await supabase
          .from("daily_allocations")
          .select("collaborator_id, works(client_id)")
          .eq("schedule_id", sched.id);
        (data ?? []).forEach((a) => {
          const cid = (a as unknown as { works: { client_id: string | null } | null }).works?.client_id;
          if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
        });
      }
      const { data: vs } = await supabase
        .from("vehicle_schedules")
        .select("client_id, vehicle_id")
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
    const rows = (clients.data ?? [])
      .filter((c) => c.needs_company_transport)
      .map((c) => {
        const people = counts[c.id] ?? 0;
        const vehicleRows = (needs.data?.vehicleRows ?? []).filter((v) => v.client_id === c.id);
        const seats = vehicleRows.reduce((s, v) => s + (capacityOf.get(v.vehicle_id) ?? 0), 0);
        return { id: c.id, name: c.name, people, vehicles: vehicleRows.length, seats };
      })
      .filter((r) => r.people > 0 || r.vehicles > 0);
    return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [clients.data, needs.data, capacityOf]);

  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    return (drivers.data ?? []).filter((d) => !q || d.full_name.toLowerCase().includes(q));
  }, [drivers.data, driverSearch]);

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
                  {d.slice(8)} <span className="uppercase text-muted-foreground">{weekdayOf(d)}</span>
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
                <td className="sticky left-0 z-10 w-40 min-w-40 border-b border-r border-border bg-card px-2 py-1 align-middle leading-tight shadow-[inset_-1px_0_0_0_hsl(var(--border))]">
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        title="Mover para cima"
                        disabled={!canWrite}
                        onClick={() => moveVehicle(v.id, -1)}
                        className="rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Mover para baixo"
                        disabled={!canWrite}
                        onClick={() => moveVehicle(v.id, 1)}
                        className="rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
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
                            </div>
                            <div className="truncate text-[10px] uppercase text-muted-foreground">
                              {row.km}km {row.is_external ? "EXTERNO" : clientName.get(row.client_id ?? "") ?? "—"}
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
          <Input type="date" value={needsDate} onChange={(e) => setNeedsDate(e.target.value)} className="w-44" />
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Programação do veículo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Motorista</Label>
              <Input placeholder="Buscar motorista" value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} />
              <Select value={form.driver_id} onValueChange={(v) => setForm((f) => ({ ...f, driver_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem motorista</SelectItem>
                  {filteredDrivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Obra / Cliente</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm((f) => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione a obra" /></SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                  <SelectItem value={EXTERNAL_KEY}>EXTERNO</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.client_id === EXTERNAL_KEY
                  ? `Externo: ${KM_EXTERNAL} km no dia, sem prêmio de motorista e sem prêmio de viagem.`
                  : form.client_id && form.client_id !== NONE
                    ? `${clientKm.get(form.client_id) ?? 0} km no dia (distância cadastrada do cliente).`
                    : "A quilometragem vem da distância cadastrada do cliente."}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label>Recebe Prêmio de Motorista</Label>
                <p className="text-xs text-muted-foreground">Verde = recebe · Cinza = não recebe</p>
              </div>
              <Switch
                checked={form.driver_bonus && form.client_id !== EXTERNAL_KEY}
                disabled={form.client_id === EXTERNAL_KEY}
                onCheckedChange={(v) => setForm((f) => ({ ...f, driver_bonus: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Repetir até (opcional)</Label>
              <Input type="date" value={form.repeat_until} onChange={(e) => setForm((f) => ({ ...f, repeat_until: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Aplica a mesma programação nos dias seguintes até a data escolhida.</p>
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

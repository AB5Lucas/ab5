import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import type { LogAddress, LogDemand, LogDriver, LogItem, LogRestriction, LogVehicle } from "@/lib/logistics";

export type DemandRow = LogDemand & { client_id: string | null; work_id: string | null; created_at: string; items: (LogItem & { id: string; material_id: string | null })[] };
export type Material = { id: string; name: string; unit: string; weight_kg: number; length_m: number | null; volume_m3: number | null; active: boolean };
export type Address = LogAddress & { client_id: string | null; active: boolean };
export type Vehicle = LogVehicle & { brand: string | null; assign_by_work: boolean | null };
export type Driver = LogDriver & { phone: string | null };

export const LOG_KEY = ["logistica"];

/** Tudo que a Logística lê (cadastros, demandas com itens e a Transporte da semana para conflitos). */
export function useLogData() {
  const base = useQuery({
    queryKey: [...LOG_KEY, "base"],
    queryFn: async () => {
      const [v, d, a, m, r, c] = await Promise.all([
        supabase.from("vehicles").select("id, plate, brand, model, type, status, assign_by_work, cargo_capacity_kg, bed_length_m, cargo_volume_m3, cnh_category, has_crane").order("plate"),
        supabase.from("collaborators").select("id, full_name, driver_license_category, driver_license_expiry, phone").eq("status", "active").not("driver_license_category", "is", null).order("full_name"),
        supabase.from("log_addresses").select("*").order("name"),
        supabase.from("log_materials").select("*").order("name"),
        supabase.from("log_city_restrictions").select("city, weekday, plate_endings, windows").order("weekday"),
        supabase.from("clients").select("id, name, city").order("name"),
      ]);
      return {
        vehicles: (v.data ?? []) as Vehicle[], drivers: (d.data ?? []) as Driver[], addresses: (a.data ?? []) as Address[],
        materials: (m.data ?? []) as Material[], rules: (r.data ?? []) as LogRestriction[], clients: c.data ?? [],
      };
    },
  });
  const demands = useQuery({
    queryKey: [...LOG_KEY, "demands"],
    queryFn: async () => {
      // Só o período útil: programadas dos últimos 60 dias em diante e as pendentes sem data (antes lia o histórico todo).
      const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const rows = await fetchAll<any>((a, b) => supabase.from("log_demands").select("*").or(`scheduled_date.is.null,scheduled_date.gte.${from}`).order("created_at", { ascending: false }).order("id").range(a, b));
      const ids = rows.map((r) => r.id);
      const items: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("log_demand_items").select("*").in("demand_id", ids.slice(i, i + 200)).order("created_at");
        items.push(...(data ?? []));
      }
      return rows.map((r) => ({ ...r, items: items.filter((i) => i.demand_id === r.id) })) as DemandRow[];
    },
  });
  return { base, demands };
}

export type TransportBusy = { vehicles: Map<string, "busy" | "maintenance">; drivers: Set<string> };

/** Veículos e motoristas escalados na Transporte por dia (aviso de conflito; Manutenção/Revisão do veículo = vermelho). */
export function useTransportBusy(from: string, to: string) {
  return useQuery({
    queryKey: [...LOG_KEY, "transport", from, to],
    queryFn: async (): Promise<TransportBusy> => {
      const rows = await fetchAll<{ vehicle_id: string; schedule_date: string; driver_id: string | null; extra_driver_ids: string[] | null; is_maintenance: boolean | null }>((a, b) =>
        supabase.from("vehicle_schedules").select("vehicle_id, schedule_date, driver_id, extra_driver_ids, is_maintenance")
          .gte("schedule_date", from).lte("schedule_date", to).order("id").range(a, b));
      const vehicles = new Map<string, "busy" | "maintenance">();
      const drivers = new Set<string>();
      for (const r of rows) {
        vehicles.set(`${r.vehicle_id}|${r.schedule_date}`, r.is_maintenance ? "maintenance" : "busy");
        for (const d of [r.driver_id, ...(r.extra_driver_ids ?? [])]) if (d) drivers.add(`${d}|${r.schedule_date}`);
      }
      return { vehicles, drivers };
    },
  });
}

/** Campos de conflito com a Transporte para demandAlerts. */
export function transportConflict(busy: TransportBusy | undefined, vehicleId: string | null | undefined, driverId: string | null | undefined, date: string | null | undefined) {
  if (!busy || !date) return {};
  const v = vehicleId ? busy.vehicles.get(`${vehicleId}|${date}`) : undefined;
  return { transportBusy: !!v, transportMaintenance: v === "maintenance", transportDriverBusy: !!driverId && busy.drivers.has(`${driverId}|${date}`) };
}

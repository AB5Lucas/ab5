import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
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
      const rows = await fetchAll<any>((a, b) => supabase.from("log_demands").select("*").order("created_at", { ascending: false }).range(a, b));
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

/** Veículos escalados na Transporte por dia (para o aviso de conflito). */
export function useTransportBusy(from: string, to: string) {
  return useQuery({
    queryKey: [...LOG_KEY, "transport", from, to],
    queryFn: async () => {
      const rows = await fetchAll<{ vehicle_id: string; schedule_date: string }>((a, b) => supabase.from("vehicle_schedules").select("vehicle_id, schedule_date")
        .gte("schedule_date", from).lte("schedule_date", to).order("id").range(a, b));
      return new Set(rows.map((r) => `${r.vehicle_id}|${r.schedule_date}`));
    },
  });
}

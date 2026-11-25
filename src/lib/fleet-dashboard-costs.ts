import { dayKm, dayToll, normalizePlate } from "@/lib/fleet-costs";

type Vehicle = { id: string; plate: string; ownership: string | null; monthly_rent: number | null };
/** Monthly budget is apportioned to days evenly, then to vehicles by their monthly km (same fleet weight). */
export function fleetDashboardCosts(vehicles: Vehicle[], schedules: any[], expenses: any[], budgets: Map<string, number>, dates: string[], single: boolean) {
  const kmMonth = new Map<string, number>();
  const kmVehicle = new Map<string, number>();
  for (const s of schedules) {
    const m = String(s.schedule_date).slice(0, 7), km = dayKm(s);
    kmMonth.set(m, (kmMonth.get(m) ?? 0) + km);
    const k = `${s.vehicle_id}|${m}`; kmVehicle.set(k, (kmVehicle.get(k) ?? 0) + km);
  }
  const byPlate = new Map(vehicles.map((v) => [normalizePlate(v.plate), v.id]));
  const daily = new Map<string, Map<string, number>>();
  const bump = (dt: string, id: string, amount: number) => { const d = daily.get(dt) ?? new Map<string, number>(); d.set(id, (d.get(id) ?? 0) + amount); daily.set(dt, d); };
  for (const e of expenses) bump(String(e.expense_date).slice(0, 10), byPlate.get(normalizePlate(e.plate)) ?? "unmatched", Number(e.amount) || 0);
  for (const s of schedules) bump(s.schedule_date, s.vehicle_id, dayToll(s));
  const daysInMonth = (dt: string) => new Date(Date.UTC(Number(dt.slice(0, 4)), Number(dt.slice(5, 7)), 0)).getUTCDate();
  for (const dt of dates) for (const v of vehicles) if (v.ownership === "alugado") bump(dt, v.id, Number(v.monthly_rent ?? 0) / daysInMonth(dt));
  if (single) {
    const dt = dates[0]; if (!dt) return [];
    const m = dt.slice(0, 7), allKm = kmMonth.get(m) ?? 0;
    return vehicles.map((v) => ({ label: v.plate, a: allKm ? (budgets.get(m) ?? 0) / daysInMonth(dt) * (kmVehicle.get(`${v.id}|${m}`) ?? 0) / allKm : 0, b: daily.get(dt)?.get(v.id) ?? 0 }));
  }
  return dates.map((dt) => ({ label: `${dt.slice(8, 10)}/${dt.slice(5, 7)}`, a: (budgets.get(dt.slice(0, 7)) ?? 0) / daysInMonth(dt), b: [...(daily.get(dt)?.values() ?? [])].reduce((sum, v) => sum + v, 0) }));
}
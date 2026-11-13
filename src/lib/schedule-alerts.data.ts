import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { todayISO } from "@/lib/scheduling";
import { addDaysIso, scheduleAlerts, type AlertData, type AlertWork } from "@/lib/schedule-alerts";

const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

/** Lê o que os avisos da Programação precisam para o dia `date` e devolve os avisos. */
export async function fetchScheduleAlerts(date: string) {
  const prev = addDaysIso(date, -1);
  const today = todayISO();
  const [schedules, holidays, works, clients, people, vehicles, appts, future] = await Promise.all([
    safe(fetchAll<any>((a, b) => supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", addDaysIso(date, -14)).lte("schedule_date", date).range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("holidays").select("date").gte("date", addDaysIso(today, -1)).lte("date", addDaysIso(date, 40)).range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, entry_time, exit_time, exit_time_weekend, night_shift").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("clients").select("id, name, needs_company_transport").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, status, driver_license_expiry, positions(name)").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("driver_id, extra_driver_ids, client_id, extra_client_ids, is_maintenance, is_external, vehicles(plate, model)").eq("schedule_date", date).range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, type, status, client_booked, training_id, client_id, trainings(name), clients(name)").eq("scheduled_date", date).neq("status", "cancelado").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, type, training_id, client_id").eq("status", "agendado").gte("scheduled_date", today).range(a, b))),
  ]);
  const sched = schedules.find((s) => s.schedule_date === date);
  const prevSched = schedules.find((s) => s.schedule_date === prev);
  const recentIds = schedules.filter((s) => s.schedule_date < date).map((s) => s.id);
  const [allocs, prevAllocs, recentAllocs, boxes, vacations, daysOff, medical] = await Promise.all([
    sched ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id, work_id").eq("schedule_id", sched.id).range(a, b))) : [],
    prevSched ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id, work_id").eq("schedule_id", prevSched.id).range(a, b))) : [],
    recentIds.length ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id").in("schedule_id", recentIds).range(a, b))) : [],
    sched ? safe(fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("collaborator_id").eq("schedule_id", sched.id).range(a, b))) : [],
    safe(fetchAll<any>((a, b) => supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date).range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date).gte("date", addDaysIso(date, -60)).range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date).range(a, b))),
  ]);
  const staffIds = [...new Set(allocs.map((a: any) => a.collaborator_id as string))];
  const chunk = <T,>(l: T[], n = 150) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
  const byStaff = async (table: string, cols: string) => (await Promise.all(chunk(staffIds).map((ids) =>
    safe(fetchAll<any>((a, b) => supabase.from(table as any).select(cols).in("collaborator_id", ids).range(a, b)))))).flat();
  const [asos, ints, trns] = staffIds.length
    ? await Promise.all([byStaff("asos", "collaborator_id, expires_at"), byStaff("client_integrations", "collaborator_id, client_id, expires_at, documentation"), byStaff("collaborator_trainings", "collaborator_id, training_id, expires_at, trainings(name)")])
    : [[], [], []];

  const kind = (t: string) => { const s = String(t).toLowerCase(); return s.includes("aso") ? "aso" : s.startsWith("trein") ? "trn" : s.startsWith("integ") ? "int" : ""; };
  const covered = new Set<string>();
  for (const a of future) {
    const k = kind(a.type);
    if (k === "aso") covered.add(`aso|${a.collaborator_id}`);
    if (k === "trn" && a.training_id) covered.add(`trn|${a.collaborator_id}|${a.training_id}`);
    if (k === "int" && a.client_id) covered.add(`int|${a.collaborator_id}|${a.client_id}`);
  }
  const data: AlertData = {
    date, today, now: new Date(),
    holidays: new Set(holidays.map((h) => h.date)),
    scheduleExists: !!sched,
    allocations: allocs, prevAllocations: prevAllocs,
    works: new Map(works.map((w) => [w.id, w as AlertWork])),
    clients: new Map(clients.map((c) => [c.id, { name: c.name, needs_company_transport: c.needs_company_transport }])),
    people: new Map(people.map((p) => [p.id, { name: p.full_name, position: p.positions?.name ?? null, cnh: p.driver_license_expiry, active: p.status === "active" }])),
    vehicles: vehicles.map((v) => ({
      plate: v.vehicles ? `${v.vehicles.plate}${v.vehicles.model ? ` - ${v.vehicles.model}` : ""}` : "veículo", driver_id: v.driver_id,
      extra_driver_ids: v.extra_driver_ids ?? [], client_id: v.client_id, extra_client_ids: v.extra_client_ids ?? [], is_maintenance: !!v.is_maintenance, is_external: !!v.is_external,
    })),
    appointments: appts.map((a) => ({
      collaborator_id: a.collaborator_id, type: kind(a.type) === "trn" ? "treinamento" : a.type, status: a.status, client_booked: !!a.client_booked,
      label: kind(a.type) === "trn" ? `treinamento ${a.trainings?.name ?? ""}`.trim() : kind(a.type) === "int" ? `integração ${a.clients?.name ?? ""}`.trim() : "ASO",
    })),
    covered,
    asos, integrations: ints,
    trainings: trns.map((t: any) => ({ collaborator_id: t.collaborator_id, training_id: t.training_id, name: t.trainings?.name ?? "treinamento", expires_at: t.expires_at })),
    accounted: new Set([
      ...boxes.map((x: any) => x.collaborator_id), ...vacations.map((x: any) => x.collaborator_id), ...medical.map((x: any) => x.collaborator_id),
      ...daysOff.filter((x: any) => (x.end_date ?? x.date) >= date).map((x: any) => x.collaborator_id), ...appts.map((x: any) => x.collaborator_id),
    ]),
    recent: new Set(recentAllocs.map((x: any) => x.collaborator_id)),
  };
  return { alerts: scheduleAlerts(data), holidays: data.holidays };
}

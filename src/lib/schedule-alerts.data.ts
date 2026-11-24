import { supabase } from "@/integrations/supabase/client";
import { transportNeedsTravel, travelActiveIds } from "@/lib/travel-active";
import { fetchAll } from "@/lib/fetch-all";
import { todayISO } from "@/lib/scheduling";
import { workVtDefault } from "@/lib/transport-rules";
import { addDaysIso, scheduleAlerts, type AlertData, type AlertWork } from "@/lib/schedule-alerts";
import { cityHolidaysOn, type CityHoliday } from "@/lib/holidays";
import { readCadastro } from "@/lib/cadastro-cache";
import type { QueryClient } from "@tanstack/react-query";

const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

/** Serviços e clientes (cadastro) — mesma leitura para os avisos da Programação e a distribuição da aba Serviços. */
export const readWorksCadastro = (qc?: QueryClient) => readCadastro(qc, "works", () =>
  fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, active, entry_time, exit_time, exit_time_weekend, night_shift").order("id").range(a, b)));
export const readClientsCadastro = (qc?: QueryClient) => readCadastro(qc, "clients", () =>
  fetchAll<any>((a, b) => supabase.from("clients").select("id, name, city, distance_km, needs_company_transport, needs_transport_voucher").order("id").range(a, b)));

/** Lê o que os avisos da Programação precisam para o dia `date` e devolve os avisos.
 * Com `qc`, os cadastros (serviços, clientes, colaboradores, catálogo de feriados) vêm do cache de 5 min (readCadastro);
 * só os dados do dia são relidos a cada gravação. */
export async function fetchScheduleAlerts(date: string, qc?: QueryClient) {
  const prev = addDaysIso(date, -1);
  const today = todayISO();
  const [schedules, holidays, works, clients, people, vehicles, appts, future] = await Promise.all([
    safe(fetchAll<any>((a, b) => supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", addDaysIso(date, -14)).lte("schedule_date", date).order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("holidays").select("date").gte("date", addDaysIso(today, -1)).lte("date", addDaysIso(date, 40)).order("id").range(a, b))),
    safe(readWorksCadastro(qc)),
    safe(readClientsCadastro(qc)),
    safe(readCadastro(qc, "collaborators:alerts", () => fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, status, contract_type, driver_license_expiry, vt_enabled, city, notice_end, positions(name)").order("id").range(a, b)))),
    safe(fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("driver_id, extra_driver_ids, client_id, extra_client_ids, is_maintenance, is_external, is_suzano_local, vehicles(plate, model)").eq("schedule_date", date).order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, type, status, client_booked, training_id, client_id, trainings(name), clients(name)").eq("scheduled_date", date).neq("status", "cancelado").order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, type, training_id, client_id").eq("status", "agendado").gte("scheduled_date", today).order("id").range(a, b))),
  ]);
  // Também cobrem: realizados nos últimos 60 dias (documento aguardando a Conferência) e os treinamentos exigidos pelos clientes.
  const [doneRecent, requiredRows] = await Promise.all([
    safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, type, training_id, client_id").eq("status", "realizado").gte("scheduled_date", addDaysIso(today, -60)).order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("client_required_trainings").select("client_id, training_id").range(a, b))),
  ]);
  const required = new Map<string, Set<string>>();
  for (const r of requiredRows) required.set(r.client_id, new Set([...(required.get(r.client_id) ?? []), r.training_id]));
  const sched = schedules.find((s) => s.schedule_date === date);
  const prevSched = schedules.find((s) => s.schedule_date === prev);
  const recentIds = schedules.filter((s) => s.schedule_date < date).map((s) => s.id);
  const [allocs, prevAllocs, recentAllocs, boxes, vacations, daysOff, medical, workVt, passengers] = await Promise.all([
    sched ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id, work_id, vt_override, travel_bonus_override").eq("schedule_id", sched.id).order("id").range(a, b))) : [],
    prevSched ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id, work_id").eq("schedule_id", prevSched.id).order("id").range(a, b))) : [],
    recentIds.length ? safe(fetchAll<any>((a, b) => supabase.from("daily_allocations").select("collaborator_id").in("schedule_id", recentIds).order("id").range(a, b))) : [],
    sched ? safe(fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("collaborator_id").eq("schedule_id", sched.id).order("id").range(a, b))) : [],
    safe(fetchAll<any>((a, b) => supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date).order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date).or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`).order("id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date).order("id").range(a, b))),
    sched ? safe(fetchAll<any>((a, b) => supabase.from("schedule_work_vt").select("work_id, pays_vt").eq("schedule_id", sched.id).order("id").range(a, b))) : [],
    safe(fetchAll<any>((a, b) => supabase.from("transport_passengers").select("client_id").eq("schedule_date", date).order("id").range(a, b))),
  ]);
  const [catalog, decisions, clientHol] = await Promise.all([
    safe(readCadastro(qc, "city_holiday_catalog", () => fetchAll<any>((a, b) => supabase.from("city_holiday_catalog").select("*").order("id").range(a, b)))) as Promise<CityHoliday[]>,
    safe(fetchAll<any>((a, b) => supabase.from("holiday_alert_decisions").select("client_id").eq("date", date).order("client_id").range(a, b))),
    safe(fetchAll<any>((a, b) => supabase.from("client_holidays").select("client_id").eq("date", date).order("client_id").range(a, b))),
  ]);
  const decided = new Set([...decisions.map((x: any) => x.client_id), ...clientHol.map((x: any) => x.client_id)]);
  const municipal = clients.filter((c) => !decided.has(c.id)).flatMap((c) =>
    cityHolidaysOn(catalog, c.city, date).slice(0, 1).map((h) => ({ clientId: c.id as string, clientName: c.name as string, city: h.city, name: h.name })));
  // VT de cada escalado, como no Fechamento: desligado no cadastro = não; senão o ajuste da pessoa no dia, o do serviço no dia,
  // o padrão do cliente ou cidade Pouso Alegre.
  const workVtBy = new Map(workVt.map((v: any) => [v.work_id, v.pays_vt as boolean | null]));
  const personBy = new Map(people.map((p) => [p.id, p]));
  const clientBy = new Map(clients.map((c) => [c.id, c]));
  const workBy = new Map(works.map((w) => [w.id, w]));
  const vtOf = (a: any) => {
    const p = personBy.get(a.collaborator_id);
    const base = p?.vt_enabled === false ? false
      : (workVtDefault(workVtBy.get(a.work_id), clientBy.get(workBy.get(a.work_id)?.client_id)?.needs_transport_voucher) || String(p?.city ?? "").toLowerCase().includes("pouso alegre"));
    return !!(a.vt_override ?? base);
  };
  const staffIds = [...new Set(allocs.map((a: any) => a.collaborator_id as string))];
  const chunk = <T,>(l: T[], n = 150) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
  const byStaff = async (table: string, cols: string) => (await Promise.all(chunk(staffIds).map((ids) =>
    safe(fetchAll<any>((a, b) => supabase.from(table as any).select(cols).in("collaborator_id", ids).order("id").range(a, b)))))).flat();
  const [asos, ints, trns] = staffIds.length
    ? await Promise.all([byStaff("asos", "collaborator_id, expires_at"), byStaff("client_integrations", "collaborator_id, client_id, expires_at, documentation"), byStaff("collaborator_trainings", "collaborator_id, training_id, expires_at, trainings(name)")])
    : [[], [], []];

  const kind = (t: string) => { const s = String(t).toLowerCase(); return s.includes("aso") ? "aso" : s.startsWith("trein") ? "trn" : s.startsWith("integ") ? "int" : ""; };
  const covered = new Set<string>();
  for (const a of [...future, ...doneRecent]) {
    const k = kind(a.type);
    if (k === "aso") covered.add(`aso|${a.collaborator_id}`);
    if (k === "trn" && a.training_id) covered.add(`trn|${a.collaborator_id}|${a.training_id}`);
    if (k === "int" && a.client_id) covered.add(`int|${a.collaborator_id}|${a.client_id}`);
  }
  // Suzano Local (sem cliente na Transporte) atende a Suzano, como nas Necessidades de transporte.
  const suzanoId = (clients.find((c) => /^suzano$/i.test(String(c.name ?? "").trim())) ?? clients.find((c) => /suzano/i.test(String(c.name ?? ""))))?.id ?? null;
  // Três Corações: só precisa de carro se alguém escalado tem prêmio viagem ativo (transportNeedsTravel).
  const travelAllocs = allocs.filter((a: any) => transportNeedsTravel(clientBy.get(workBy.get(a.work_id)?.client_id)?.name));
  const traveling = travelAllocs.length
    ? await travelActiveIds(date, sched?.id ?? null, travelAllocs, travelAllocs.map((a: any) => {
        const c = clientBy.get(workBy.get(a.work_id)?.client_id);
        return { id: a.work_id, client_name: c?.name, client_city: c?.city, client_distance_km: c?.distance_km };
      })).catch(() => new Set<string>())
    : new Set<string>();
  const data: AlertData = {
    date, today, now: new Date(),
    holidays: new Set(holidays.map((h) => h.date)),
    scheduleExists: !!sched,
    allocations: allocs.map((a: any) => ({ collaborator_id: a.collaborator_id, work_id: a.work_id, vt: vtOf(a), travel: traveling.has(a.collaborator_id) })), prevAllocations: prevAllocs,
    builtTransport: new Set(passengers.map((p: any) => p.client_id)),
    works: new Map(works.map((w) => [w.id, w as AlertWork])),
    clients: new Map(clients.map((c) => [c.id, { name: c.name, needs_company_transport: c.needs_company_transport }])),
    people: new Map(people.map((p) => [p.id, { name: p.full_name, position: p.positions?.name ?? null, cnh: p.driver_license_expiry, active: p.status === "active", contract: p.contract_type, noticeEnd: p.notice_end ?? null }])),
    vehicles: vehicles.map((v) => ({
      plate: v.vehicles ? `${v.vehicles.plate}${v.vehicles.model ? ` - ${v.vehicles.model}` : ""}` : "veículo", driver_id: v.driver_id,
      extra_driver_ids: v.extra_driver_ids ?? [], client_id: v.client_id ?? (v.is_suzano_local ? suzanoId : null), extra_client_ids: v.extra_client_ids ?? [], is_maintenance: !!v.is_maintenance, is_external: !!v.is_external,
    })),
    appointments: appts.map((a) => ({
      collaborator_id: a.collaborator_id, type: kind(a.type) === "trn" ? "treinamento" : kind(a.type) === "int" ? "integracao" : a.type, status: a.status, client_booked: !!a.client_booked,
      label: kind(a.type) === "trn" ? `treinamento ${a.trainings?.name ?? ""}`.trim() : kind(a.type) === "int" ? `integração ${a.clients?.name ?? ""}`.trim() : "ASO",
    })),
    covered,
    asos, integrations: ints, required,
    trainings: trns.map((t: any) => ({ collaborator_id: t.collaborator_id, training_id: t.training_id, name: t.trainings?.name ?? "treinamento", expires_at: t.expires_at })),
    accounted: new Set([
      ...boxes.map((x: any) => x.collaborator_id), ...vacations.map((x: any) => x.collaborator_id), ...medical.map((x: any) => x.collaborator_id),
      ...daysOff.filter((x: any) => (x.end_date ?? x.date) >= date).map((x: any) => x.collaborator_id), ...appts.map((x: any) => x.collaborator_id),
    ]),
    recent: new Set(recentAllocs.map((x: any) => x.collaborator_id)),
    municipal,
  };
  return { alerts: scheduleAlerts(data), holidays: data.holidays };
}

import { supabase } from "@/integrations/supabase/client";
import { integrationTravelOn } from "@/lib/schedule-box-benefits";
import { buildDistanceLookup } from "@/lib/city-distance";
import { loadBuiltTransport, driverBonusFor, vtForDay, travelOnFor, type BuiltTransport } from "@/lib/transport-rules";
import { driverBonusDays, type BonusDay } from "@/lib/driver-bonus";
import { effectiveCity, lodgingBlocksBenefits, lodgingBlocksVtAlways, lodgingIndex, type LodgingStay } from "@/lib/lodging";

/** Fechamento: competência = dia 26 do mês anterior até 25 do mês selecionado. */
export function periodOf(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(new Date(y, m - 2, 26)), end: fmt(new Date(y, m - 1, 26)) }; // end exclusivo
}

const STATUS_LABEL: Record<string, string> = {
  folga: "Folga", atestado: "Atestado", ferias: "Férias", medico: "Médico", afastado: "Afastado",
  falta: "Falta", interjornada: "Interjornada", licenca: "Licença", abono: "Abono",
  aso: "ASO", treinamento: "Treinamento",
};
const statusLabel = (k: string) => (k.startsWith("integracao") ? "Integração" : STATUS_LABEL[k] ?? k);

export type DayRow = { date: string; work: string; status: string; counted: boolean; reason?: string | undefined };
export type VtRow = { date: string; work: string; pays: boolean; value: number };
export type PrizeRow = { date: string; vehicle: string; work: string; distance: number; value: number };
export type Adjustment = { id: string; collaborator_id: string; kind: "vt" | "premio"; entry_date: string; description: string | null; amount: number; notes: string | null };
export type ClosingRow = {
  id: string; reg: string; name: string;
  meals: number; days: DayRow[];
  vtAuto: number; vtRows: VtRow[]; vtManual: number;
  prizeAuto: number; prizeRows: PrizeRow[]; prizeManual: number;
  adjustments: Adjustment[];
  contract?: string;
};

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const OVERNIGHT_PRIZE = 25;

/** Ausências cadastradas (atestado, férias, folga) entre start e end (exclusivo), indexadas por pessoa. */
export async function loadAbsenceIndex(start: string, end: string) {
  const [daysOff, vacations, leaves] = await Promise.all([
    all<any>((f, t) => supabase.from("days_off").select("collaborator_id, date, end_date").lt("date", end).or(`end_date.gte.${start},and(end_date.is.null,date.gte.${start})`).order("id").range(f, t)),
    all<any>((f, t) => supabase.from("vacations").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start).order("id").range(f, t)),
    all<any>((f, t) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start).order("id").range(f, t)),
  ]);
  return absenceIndex(leaves, vacations, daysOff);
}

function absenceIndex(leaves: any[] | null | undefined, vacations: any[] | null | undefined, daysOff: any[] | null | undefined) {
  const inRange = (d: string, s: string, e: string | null) => d >= s && d <= (e ?? s);
  const byPerson = <T extends { collaborator_id: string }>(rows: T[] | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) { const l = m.get(r.collaborator_id); if (l) l.push(r); else m.set(r.collaborator_id, [r]); }
    return m;
  };
  const leavesBy = byPerson(leaves), vacationsBy = byPerson(vacations), daysOffBy = byPerson(daysOff);
  return (cid: string, d: string): string | null => {
    if ((leavesBy.get(cid) ?? []).some((l) => inRange(d, l.start_date, l.end_date))) return "Atestado";
    if ((vacationsBy.get(cid) ?? []).some((l) => inRange(d, l.start_date, l.end_date))) return "Férias";
    if ((daysOffBy.get(cid) ?? []).some((l) => inRange(d, l.date, l.end_date))) return "Folga";
    return null;
  };
}

export type DriverBonusDay = BonusDay<any> & { toll: number };
/**
 * Prêmio Motorista do período (start inclusive, end exclusivo) — a regra paga no Fechamento e mostrada na tela
 * Benefícios › Prêmio Motorista: lib/driver-bonus.ts com elegibilidade = sem ausência no dia e
 * (transporte montado do cliente do frete → motorista não PJ; senão o botão Prêmio de Motorista da linha).
 * Também devolve o pedágio do dia de cada motorista (ida e volta por viagem; local Indústria com pedágio próprio substitui o do cliente).
 */
export async function loadDriverBonus(start: string, end: string, ctx: { transport?: BuiltTransport; absence?: (id: string, date: string) => string | null } = {}) {
  const [vsch, { data: dbr }, { data: clients }, transport, absence] = await Promise.all([
    all<any>((f, t) => supabase.from("vehicle_schedules").select("driver_id, client_id, work_id, driver_bonus, schedule_date, km, trips, extra_km, extra_client_ids, extra_driver_ids, extra_places, extra_work_ids, is_external, is_maintenance, external_place, is_suzano_local, place_toll")
      .gte("schedule_date", start).lt("schedule_date", end).order("id").range(f, t)),
    supabase.from("driver_bonus_rules").select("*").eq("active", true),
    supabase.from("clients").select("id, name, has_toll, toll_amount"),
    ctx.transport ? Promise.resolve(ctx.transport) : loadBuiltTransport(start, end),
    ctx.absence ? Promise.resolve(ctx.absence) : loadAbsenceIndex(start, end),
  ]);
  const clientBy = new Map((clients ?? []).map((c) => [c.id, c]));
  const industry = new Set((clients ?? []).filter((c) => /ind[uú]stria/i.test(c.name ?? "")).map((c) => c.id));
  const ids = [...new Set(vsch.flatMap((v) => [v.driver_id, ...(v.extra_driver_ids ?? [])]).filter(Boolean))] as string[];
  const info = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("collaborators").select("id, full_name, registration_number, contract_type").in("id", ids.slice(i, i + 200));
    for (const c of data ?? []) info.set(c.id, c);
  }
  const days = driverBonusDays(vsch, (dbr ?? []) as any[], {
    monthly: true,
    isIndustry: (c) => !!c && industry.has(c),
    eligible: (f) => !absence(f.driverId, f.date)
      && driverBonusFor(transport, { client_id: f.clientId, schedule_date: f.date, driver_id: f.driverId, driver_bonus: !!f.schedule.driver_bonus }, info.get(f.driverId)?.contract_type === "pj"),
  });
  const clientToll = (id: string | null | undefined) => { const c = id ? clientBy.get(id) : undefined; return c?.has_toll ? Number(c.toll_amount ?? 0) || 0 : 0; };
  const out: DriverBonusDay[] = days.map((d) => ({
    ...d,
    toll: d.freights.reduce((s, f) => {
      const v = f.schedule;
      if (f.index > 0) return s + ((v.extra_places?.[f.index - 1] ?? "").trim() ? 0 : clientToll(f.clientId) * 2);
      if (v.is_suzano_local) return s;
      const oneWay = v.place_toll != null ? Number(v.place_toll) : clientToll(v.client_id);
      return s + oneWay * 2 * Math.max(1, Number(v.trips ?? 1) || 1);
    }, 0),
  }));
  return { days: out, info };
}

export async function loadClosing(month: string): Promise<ClosingRow[]> {
  const { start, end } = periodOf(month);
  const { data: schedules } = await supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", start).lt("schedule_date", end);
  const ids = (schedules ?? []).map((s) => s.id);
  const dateById = new Map((schedules ?? []).map((s) => [s.id, s.schedule_date]));
  const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });

  const [allocs, entries, workVt, boxVtR, personVtR, holidays, daysOff, vacations, leaves, rdoWf, vtRules, tbRules, adjs] = await Promise.all([
    ids.length ? all<any>((f, t) => supabase.from("daily_allocations")
      .select("collaborator_id, schedule_id, work_id, driver, overnight, vt_override, travel_bonus_override, vehicles(plate), collaborators(full_name, registration_number, city, vt_enabled, vt_always_full, travel_bonus_enabled, positions(name)), works(name, city, distance_km, client_id, clients(name, city, distance_km, needs_transport_voucher))")
      .in("schedule_id", ids).order("id").range(f, t)) : [],
    ids.length ? all<any>((f, t) => supabase.from("daily_status_entries")
      .select("schedule_id, collaborator_id, box_key, collaborators(full_name, registration_number, city, travel_bonus_enabled)").in("schedule_id", ids).order("id").range(f, t)) : [],
    ids.length ? supabase.from("schedule_work_vt").select("schedule_id, work_id, pays_vt").in("schedule_id", ids) : empty<any>(),
    ids.length ? supabase.from("schedule_box_vt").select("schedule_id, box_key, pays_vt").in("schedule_id", ids) : empty<any>(),
    ids.length ? supabase.from("schedule_person_vt").select("schedule_id, box_key, collaborator_id, pays_vt, pays_bonus").in("schedule_id", ids) : empty<any>(),
    supabase.from("holidays").select("date, name").gte("date", start).lt("date", end),
    // Sem limite inferior a leitura cortava em 1000 linhas (folgas antigas ocupavam o lugar das do mês).
    all<any>((f, t) => supabase.from("days_off").select("collaborator_id, date, end_date").lt("date", end).or(`end_date.gte.${start},and(end_date.is.null,date.gte.${start})`).order("id").range(f, t)),
    all<any>((f, t) => supabase.from("vacations").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start).order("id").range(f, t)),
    all<any>((f, t) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start).order("id").range(f, t)),
    all<any>((f, t) => supabase.from("rdo_workforce").select("collaborator_id, report_date, present, final_classification, reported_reason")
      .gte("report_date", start).lt("report_date", end).order("id").range(f, t)),
    supabase.from("transport_voucher_rules").select("*").eq("active", true),
    supabase.from("travel_bonus_rules").select("*").eq("active", true),
    supabase.from("closing_adjustments").select("*").gte("entry_date", start).lt("entry_date", end).order("entry_date"),
  ]);
  const { data: cityDist } = await supabase.from("city_distances").select("city_a, city_b, km");
  const { data: clientsR } = await supabase.from("clients").select("name, city, distance_km");
  const clientByName = new Map((clientsR ?? []).map((c: any) => [String(c.name).trim().toLowerCase(), c]));
  const distFor = buildDistanceLookup(cityDist ?? []);
  // Alojamentos no mês (Americana: sem VT/prêmio na Suzano; Mogi Guaçu: como morador de Mogi Guaçu).
  const { data: staysR } = await supabase.from("lodging_stays").select("collaborator_id, lodging, start_date, end_date").lt("start_date", end).or(`end_date.is.null,end_date.gte.${start}`);
  const lodgingAt = lodgingIndex((staysR ?? []) as LodgingStay[]);
  const transport = await loadBuiltTransport(start, end);
  const { data: trW } = ids.length ? await supabase.from("schedule_work_travel").select("schedule_id, work_id, pays_bonus").in("schedule_id", ids) : { data: [] as any[] };
  const travelWork = new Map((trW ?? []).map((v: any) => [`${v.schedule_id}|${v.work_id}`, v.pays_bonus]));


  const holiday = new Map((holidays.data ?? []).map((h) => [h.date, h.name]));
  // Exceções por cliente (Configurações › Feriados): feriado só do cliente ou feriado geral trabalhado no cliente.
  const { data: clientHol } = await supabase.from("client_holidays").select("client_id, date, is_holiday, name").gte("date", start).lt("date", end);
  const clientHolBy = new Map((clientHol ?? []).map((h) => [`${h.client_id}|${h.date}`, h]));
  const holidayName = (date: string, clientId: string | null | undefined): string | null => {
    const o = clientId ? clientHolBy.get(`${clientId}|${date}`) : undefined;
    if (o) return o.is_holiday ? o.name ?? "feriado do cliente" : null;
    return holiday.get(date) ?? null;
  };
  // Ausências indexadas por pessoa (antes: varredura das listas inteiras a cada dia de cada pessoa).
  const personAbsence = absenceIndex(leaves, vacations, daysOff);
  const rdoAbsent = new Map<string, string>();
  for (const r of rdoWf) {
    const cls = r.final_classification ?? (r.present ? null : r.reported_reason ?? "falta");
    if (cls && cls !== "trabalhado" && cls !== "presente") rdoAbsent.set(`${r.collaborator_id}|${r.report_date}`, statusLabel(cls));
  }
  const vtWork = new Map((workVt.data ?? []).map((v: any) => [`${v.schedule_id}|${v.work_id}`, v.pays_vt]));
  const boxVt = new Map((boxVtR.data ?? []).map((v: any) => [`${v.schedule_id}|${v.box_key}`, v.pays_vt]));
  const personVt = new Map((personVtR.data ?? []).map((v: any) => [`${v.schedule_id}|${v.box_key}|${v.collaborator_id}`, v.pays_vt]));
  const personTravel = new Map((personVtR.data ?? []).map((v: any) => [`${v.schedule_id}|${v.box_key}|${v.collaborator_id}`, v.pays_bonus as boolean | null]));

  const perDay = (driver: boolean, units: number) => (vtRules.data ?? []).reduce((s, r) => {
    if (driver ? !r.applies_to_drivers : !r.applies_to_collaborators) return s;
    if (r.calculation_type === "fixed_monthly") return s;
    return s + Number(r.amount) * (r.calculation_type === "round_trip" ? 2 : 1) * units;
  }, 0);
  const monthly = (driver: boolean) => (vtRules.data ?? []).reduce((s, r) =>
    r.calculation_type === "fixed_monthly" && (driver ? r.applies_to_drivers : r.applies_to_collaborators) ? s + Number(r.amount) : s, 0);
  const prizeFor = (dist: number) => (tbRules.data ?? []).reduce((s, r) => {
    const max = r.maximum_distance === null ? Infinity : Number(r.maximum_distance);
    if (dist < Number(r.minimum_distance) || dist > max) return s;
    return s + Number(r.bonus_amount) * (r.calculation_type === "round_trip" ? 2 : 1);
  }, 0);

  const rows = new Map<string, ClosingRow & { driver: boolean; seen: Set<string> }>();
  const get = (id: string, c: any) => {
    let r = rows.get(id);
    if (!r) {
      r = { id, reg: c?.registration_number ?? "", name: c?.full_name ?? "—", meals: 0, days: [], vtAuto: 0, vtRows: [], vtManual: 0, prizeAuto: 0, prizeRows: [], prizeManual: 0, adjustments: [], driver: false, seen: new Set() };
      rows.set(id, r);
    }
    return r;
  };
  const statusByKey = new Map<string, string>();
  for (const e of entries) statusByKey.set(`${e.schedule_id}|${e.collaborator_id}`, e.box_key);

  for (const a of allocs) {
    const date = dateById.get(a.schedule_id)!;
    const r = get(a.collaborator_id, a.collaborators);
    if (r.seen.has(date)) continue; // um registro por dia
    r.seen.add(date);
    const work = a.works?.clients?.name ? `${a.works.clients.name} - ${a.works.name}` : a.works?.name ?? "—";
    const st = statusByKey.get(`${a.schedule_id}|${a.collaborator_id}`);
    const hol = holidayName(date, a.works?.client_id);
    const reason = personAbsence(a.collaborator_id, date) ?? (hol ? `Feriado (${hol})`
      : st ? statusLabel(st)
      : rdoAbsent.get(`${a.collaborator_id}|${date}`) ?? null);
    r.days.push({ date, work, status: reason ?? "Trabalhado", counted: !reason, reason: reason ?? undefined });
    if (reason) continue;
    r.meals++;
    if (a.driver) r.driver = true;
    const cc = a.collaborators;
    const lodging = lodgingAt(a.collaborator_id, date);
    const blocked = lodgingBlocksBenefits(lodging, a.works?.clients?.name);
    const homeCity = effectiveCity(cc?.city, lodging);
    // Regra única do VT (lib/transport-rules.ts vtForDay): Montador alojado em Mogi Guaçu nunca; VT cheio sempre;
    // senão transporte montado ou marcação da pessoa ?? (cadastro/alojamento, marcação da obra ?? padrão do cliente, Pouso Alegre).
    const pays = vtForDay({
      vtEnabled: cc?.vt_enabled, lodgingBlocks: blocked, vtNever: lodgingBlocksVtAlways(lodging, cc?.positions?.name), alwaysFull: cc?.vt_always_full,
      workMark: vtWork.get(`${a.schedule_id}|${a.work_id}`), clientDefault: a.works?.clients?.needs_transport_voucher, homeCity,
      override: a.vt_override, transport, clientId: a.works?.client_id, date, collaboratorId: a.collaborator_id,
    });
    r.vtRows.push({ date, work, pays: !!pays, value: pays ? perDay(a.driver, 1) : 0 });
    const dist = distFor(homeCity, a.works?.clients?.city ?? a.works?.city, Number(a.works?.clients?.distance_km ?? a.works?.distance_km ?? 0));
    // Prêmio viagem (travelOnFor): cadastro com prêmio desligado nunca recebe (como a Programação e os Resultados).
    const travelOn = travelOnFor({
      enabled: cc?.travel_bonus_enabled, override: a.travel_bonus_override, lodgingBlocks: blocked,
      workMark: travelWork.get(`${a.schedule_id}|${a.work_id}`), workDefault: prizeFor(Number(a.works?.clients?.distance_km ?? a.works?.distance_km ?? 0)) > 0,
    });
    const prize = travelOn && !a.overnight ? prizeFor(dist) : 0;
    if (prize > 0) r.prizeRows.push({ date, vehicle: a.vehicles?.plate ?? "—", work, distance: dist, value: prize });
    if (a.overnight) r.prizeRows.push({ date, vehicle: "—", work: `Pernoite - ${work}`, distance: 0, value: OVERNIGHT_PRIZE });
  }
  // Dias em quadros (sem obra): aparecem no detalhamento; ASO/Treinamento/Integração podem gerar VT.
  // Vários quadros no mesmo dia não somam VT: vale o maior entre eles. Um status de ausência no dia zera o VT.
  const boxDays = new Map<string, { e: any; date: string; labels: string[]; units: number; absent: boolean; prize: { work: string; distance: number; value: number } | null }>();
  for (const e of entries) {
    const date = dateById.get(e.schedule_id)!;
    if (rows.get(e.collaborator_id)?.seen.has(date)) continue; // dia com obra
    const key = `${e.collaborator_id}|${date}`;
    const d = boxDays.get(key) ?? { e, date, labels: [] as string[], units: 0, absent: false, prize: null as { work: string; distance: number; value: number } | null };
    boxDays.set(key, d);
    const label = statusLabel(e.box_key);
    if (!d.labels.includes(label)) d.labels.push(label);
    const isBox = e.box_key === "aso" || e.box_key === "treinamento" || e.box_key.startsWith("integracao");
    if (!isBox) { d.absent = true; continue; }
    if (personAbsence(e.collaborator_id, date)) continue;
    const on = personVt.get(`${e.schedule_id}|${e.box_key}|${e.collaborator_id}`) ?? boxVt.get(`${e.schedule_id}|${e.box_key}`) ?? (e.box_key === "aso" || e.box_key === "treinamento");
    d.units = Math.max(d.units, (e.box_key === "aso" ? 1 : 0) + (on ? 1 : 0));
    // Integração: prêmio viagem pela bolinha da pessoa (padrão: cliente numa faixa de prêmio), um por dia.
    if (e.box_key.startsWith("integracao:") && !d.prize) {
      const client = clientByName.get(e.box_key.slice("integracao:".length).trim().toLowerCase());
      const lodging = lodgingAt(e.collaborator_id, date);
      const travel = e.collaborators?.travel_bonus_enabled === false || lodgingBlocksBenefits(lodging, client?.name) ? false
        : integrationTravelOn(personTravel.get(`${e.schedule_id}|${e.box_key}|${e.collaborator_id}`), Number(client?.distance_km ?? 0), (km) => prizeFor(km) > 0);
      if (travel && client) {
        const dist = distFor(effectiveCity(e.collaborators?.city, lodging), client.city, Number(client.distance_km ?? 0));
        const value = prizeFor(dist);
        if (value > 0) d.prize = { work: `Integração - ${client.name}`, distance: dist, value };
      }
    }
  }
  for (const d of boxDays.values()) {
    const r = get(d.e.collaborator_id, d.e.collaborators);
    r.seen.add(d.date);
    const label = d.labels.join(" + ");
    r.days.push({ date: d.date, work: label, status: label, counted: false, reason: label });
    if (d.units && !d.absent) r.vtRows.push({ date: d.date, work: label, pays: true, value: perDay(false, d.units) });
    if (d.prize && !d.absent) r.prizeRows.push({ date: d.date, vehicle: "—", ...d.prize });
  }
  // Prêmio Motorista (lib/driver-bonus.ts, loadDriverBonus): somado ao VT.
  const { days: bonusDays, info: driverInfo } = await loadDriverBonus(start, end, { transport, absence: personAbsence });
  for (const d of bonusDays) {
    if (!d.amount) continue;
    get(d.driverId, driverInfo.get(d.driverId)).vtRows.push({ date: d.date, work: "Prêmio Motorista", pays: true, value: d.amount });
  }
  for (const adj of (adjs.data ?? []) as Adjustment[]) {
    const r = rows.get(adj.collaborator_id) ?? get(adj.collaborator_id, null);
    r.adjustments.push(adj);
  }
  // Nomes de quem só tem lançamento manual
  const missing = [...rows.values()].filter((r) => r.name === "—").map((r) => r.id);
  if (missing.length) {
    const { data } = await supabase.from("collaborators").select("id, full_name, registration_number").in("id", missing);
    for (const c of data ?? []) { const r = rows.get(c.id)!; r.name = c.full_name; r.reg = c.registration_number; }
  }
  const ctype = new Map<string, string>();
  const rowIds = [...rows.keys()];
  for (let i = 0; i < rowIds.length; i += 200) {
    const { data } = await supabase.from("collaborators").select("id, contract_type").in("id", rowIds.slice(i, i + 200));
    for (const c of data ?? []) ctype.set(c.id, c.contract_type ?? "efetivo");
  }
  return [...rows.values()].map(({ seen: _s, driver, ...r }) => {
    r.contract = ctype.get(r.id) ?? "efetivo";
    r.days.sort((a, b) => a.date.localeCompare(b.date));
    r.vtRows.sort((a, b) => a.date.localeCompare(b.date));
    r.prizeRows.sort((a, b) => a.date.localeCompare(b.date));
    const vtDays = r.vtRows.filter((v) => v.pays && v.work !== "Prêmio Motorista").length;
    r.vtAuto = r.vtRows.reduce((s, v) => s + v.value, 0) + (vtDays ? monthly(driver) : 0);
    r.prizeAuto = r.prizeRows.reduce((s, v) => s + v.value, 0);
    r.vtManual = r.adjustments.filter((a) => a.kind === "vt").reduce((s, a) => s + Number(a.amount), 0);
    r.prizeManual = r.adjustments.filter((a) => a.kind === "premio").reduce((s, a) => s + Number(a.amount), 0);
    return r;
  }).filter((r) => r.days.length || r.adjustments.length || r.vtRows.length)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

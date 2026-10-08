import { supabase } from "@/integrations/supabase/client";
import { buildDistanceLookup } from "@/lib/city-distance";

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

export async function loadClosing(month: string): Promise<ClosingRow[]> {
  const { start, end } = periodOf(month);
  const { data: schedules } = await supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", start).lt("schedule_date", end);
  const ids = (schedules ?? []).map((s) => s.id);
  const dateById = new Map((schedules ?? []).map((s) => [s.id, s.schedule_date]));
  const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });

  const [allocs, entries, workVt, boxVtR, personVtR, holidays, daysOff, vacations, leaves, rdoWf, vtRules, tbRules, adjs] = await Promise.all([
    ids.length ? all<any>((f, t) => supabase.from("daily_allocations")
      .select("collaborator_id, schedule_id, work_id, driver, vt_override, travel_bonus_override, vehicles(plate), collaborators(full_name, registration_number, city, vt_enabled, travel_bonus_enabled), works(name, city, distance_km, clients(name, city, distance_km))")
      .in("schedule_id", ids).order("id").range(f, t)) : [],
    ids.length ? all<any>((f, t) => supabase.from("daily_status_entries")
      .select("schedule_id, collaborator_id, box_key, collaborators(full_name, registration_number)").in("schedule_id", ids).order("id").range(f, t)) : [],
    ids.length ? supabase.from("schedule_work_vt").select("schedule_id, work_id, pays_vt").in("schedule_id", ids) : empty<any>(),
    ids.length ? supabase.from("schedule_box_vt").select("schedule_id, box_key, pays_vt").in("schedule_id", ids) : empty<any>(),
    ids.length ? supabase.from("schedule_person_vt").select("schedule_id, box_key, collaborator_id, pays_vt").in("schedule_id", ids) : empty<any>(),
    supabase.from("holidays").select("date, name").gte("date", start).lt("date", end),
    supabase.from("days_off").select("collaborator_id, date, end_date").lt("date", end),
    supabase.from("vacations").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start),
    supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lt("start_date", end).gte("end_date", start),
    all<any>((f, t) => supabase.from("rdo_workforce").select("collaborator_id, report_date, present, final_classification, reported_reason")
      .gte("report_date", start).lt("report_date", end).order("id").range(f, t)),
    supabase.from("transport_voucher_rules").select("*").eq("active", true),
    supabase.from("travel_bonus_rules").select("*").eq("active", true),
    supabase.from("closing_adjustments").select("*").gte("entry_date", start).lt("entry_date", end).order("entry_date"),
  ]);
  const { data: cityDist } = await supabase.from("city_distances").select("city_a, city_b, km");
  const distFor = buildDistanceLookup(cityDist ?? []);
  const { data: trW } = ids.length ? await supabase.from("schedule_work_travel").select("schedule_id, work_id, pays_bonus").in("schedule_id", ids) : { data: [] as any[] };
  const travelWork = new Map((trW ?? []).map((v: any) => [`${v.schedule_id}|${v.work_id}`, v.pays_bonus]));


  const holiday = new Map((holidays.data ?? []).map((h) => [h.date, h.name]));
  const inRange = (d: string, s: string, e: string | null) => d >= s && d <= (e ?? s);
  const personAbsence = (cid: string, d: string): string | null => {
    if ((leaves.data ?? []).some((l) => l.collaborator_id === cid && inRange(d, l.start_date, l.end_date))) return "Atestado";
    if ((vacations.data ?? []).some((l) => l.collaborator_id === cid && inRange(d, l.start_date, l.end_date))) return "Férias";
    if ((daysOff.data ?? []).some((l) => l.collaborator_id === cid && inRange(d, l.date, l.end_date))) return "Folga";
    return null;
  };
  const rdoAbsent = new Map<string, string>();
  for (const r of rdoWf) {
    const cls = r.final_classification ?? (r.present ? null : r.reported_reason ?? "falta");
    if (cls && cls !== "trabalhado" && cls !== "presente") rdoAbsent.set(`${r.collaborator_id}|${r.report_date}`, statusLabel(cls));
  }
  const vtWork = new Map((workVt.data ?? []).map((v: any) => [`${v.schedule_id}|${v.work_id}`, v.pays_vt]));
  const boxVt = new Map((boxVtR.data ?? []).map((v: any) => [`${v.schedule_id}|${v.box_key}`, v.pays_vt]));
  const personVt = new Map((personVtR.data ?? []).map((v: any) => [`${v.schedule_id}|${v.box_key}|${v.collaborator_id}`, v.pays_vt]));

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
    const reason = holiday.has(date) ? `Feriado (${holiday.get(date)})`
      : st ? statusLabel(st)
      : personAbsence(a.collaborator_id, date) ?? rdoAbsent.get(`${a.collaborator_id}|${date}`) ?? null;
    r.days.push({ date, work, status: reason ?? "Trabalhado", counted: !reason, reason: reason ?? undefined });
    if (reason) continue;
    r.meals++;
    if (a.driver) r.driver = true;
    const cc = a.collaborators;
    const base = cc?.vt_enabled === false ? false : (vtWork.get(`${a.schedule_id}|${a.work_id}`) || (cc?.city ?? "").toLowerCase().includes("pouso alegre"));
    const pays = a.vt_override ?? base;
    r.vtRows.push({ date, work, pays: !!pays, value: pays ? perDay(a.driver, 1) : 0 });
    const dist = distFor(cc?.city, a.works?.clients?.city ?? a.works?.city, Number(a.works?.clients?.distance_km ?? a.works?.distance_km ?? 0));
    const travelOn = a.travel_bonus_override ?? ((travelWork.get(`${a.schedule_id}|${a.work_id}`) ?? prizeFor(Number(a.works?.clients?.distance_km ?? a.works?.distance_km ?? 0)) > 0));
    const prize = travelOn ? prizeFor(dist) : 0;
    if (prize > 0) r.prizeRows.push({ date, vehicle: a.vehicles?.plate ?? "—", work, distance: dist, value: prize });
  }
  // Dias em quadros (sem obra): aparecem no detalhamento; ASO/Treinamento/Integração podem gerar VT
  for (const e of entries) {
    const date = dateById.get(e.schedule_id)!;
    const r = get(e.collaborator_id, e.collaborators);
    if (r.seen.has(date)) continue;
    r.seen.add(date);
    const label = statusLabel(e.box_key);
    r.days.push({ date, work: label, status: label, counted: false, reason: label });
    const isBox = e.box_key === "aso" || e.box_key === "treinamento" || e.box_key.startsWith("integracao");
    if (!isBox) continue;
    const on = personVt.get(`${e.schedule_id}|${e.box_key}|${e.collaborator_id}`) ?? boxVt.get(`${e.schedule_id}|${e.box_key}`) ?? (e.box_key === "aso" || e.box_key === "treinamento");
    const units = (e.box_key === "aso" ? 1 : 0) + (on ? 1 : 0);
    if (units) r.vtRows.push({ date, work: label, pays: true, value: perDay(false, units) });
  }
  // Prêmio Motorista: 1 por dia dirigido (faixa pela km do dia), somado ao VT
  const [{ data: vsch }, { data: dbr }] = await Promise.all([
    supabase.from("vehicle_schedules").select("driver_id, schedule_date, km, collaborators(full_name, registration_number)")
      .gte("schedule_date", start).lt("schedule_date", end).eq("driver_bonus", true).eq("is_external", false),
    supabase.from("driver_bonus_rules").select("*").eq("active", true),
  ]);
  const dDays = new Map<string, { c: any; days: Map<string, number> }>();
  for (const v of (vsch ?? []) as any[]) {
    if (!v.driver_id) continue;
    const e = dDays.get(v.driver_id) ?? { c: v.collaborators, days: new Map<string, number>() };
    e.days.set(v.schedule_date, (e.days.get(v.schedule_date) ?? 0) + (Number(v.km ?? 0) || 0));
    dDays.set(v.driver_id, e);
  }
  for (const [id, e] of dDays) {
    const r = get(id, e.c);
    const fixed = new Set<string>();
    for (const [date, km] of e.days) {
      let val = 0;
      for (const rule of (dbr ?? []) as any[]) {
        const max = rule.maximum_distance === null ? Infinity : Number(rule.maximum_distance);
        if (km < Number(rule.minimum_distance ?? 0) || km > max) continue;
        if (rule.calculation_type === "fixed_monthly") { if (fixed.has(rule.id)) continue; fixed.add(rule.id); }
        val += Number(rule.amount);
      }
      if (val) r.vtRows.push({ date, work: "Prêmio Motorista", pays: true, value: val });
    }
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
  return [...rows.values()].map(({ seen: _s, driver, ...r }) => {
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

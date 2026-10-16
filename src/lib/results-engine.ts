import { supabase } from "@/integrations/supabase/client";
import { contractFraction } from "@/lib/contract";
import { resplitClient } from "@/lib/resplit";
import { laborCost, ENCARGOS } from "@/lib/labor-cost";
import { buildDistanceLookup } from "@/lib/city-distance";

/** Motor de cálculo de Resultados — usado pela página Resultados e pelo Financeiro (mesma lógica). */
export const TAX_RATE = 0.1867;
export const KM_RATE = 1.35;
export const DEFAULT_HOURS = 8;
export const ITEMS = [
  { key: "mo", label: "Mão de obra" },
  { key: "transporte", label: "Transporte" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "materiais", label: "Materiais" },
  { key: "andaimes", label: "Andaimes" },
] as const;
export type ItemKey = (typeof ITEMS)[number]["key"];
export const entryItem = (cat: string): ItemKey | null =>
  cat === "mao_obra" ? "mo" : cat === "terceiros" ? "transporte" : cat === "ferramentas" || cat === "materiais" || cat === "andaimes" ? cat : null;
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
};
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y!, m!, 0).getDate()).padStart(2, "0")}`;
};

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const RESPLIT_AT = new Map<string, number>();

/** Carrega os dados brutos de um serviço (ou de vários, em "Todos os serviços"). */
export async function loadWorkData(work: any, workIds: string[], canWrite: boolean): Promise<any> {
      const w = work;
      // Rateios vigentes: refaz pelas horas atuais (inclui serviços novos com horas no mês)
      if (canWrite && w.client_id && Date.now() - (RESPLIT_AT.get(w.client_id) ?? 0) > 5 * 60_000) {
        RESPLIT_AT.set(w.client_id, Date.now());
        const { data: sib } = await supabase.from("works").select("id").eq("client_id", w.client_id);
        await resplitClient((sib ?? []).map((x) => x.id)).catch(() => false);
      }
      const [allocs, rdoWf, progress, entries, people, siblings, vs, client] = await Promise.all([
        fetchAll<any>((a, b) =>
          supabase.from("daily_allocations").select("work_id, collaborator_id, schedule_id, driver, vt_override, travel_bonus_override, daily_schedules(schedule_date)").in("work_id", workIds).range(a, b),
        ),
        fetchAll<any>((a, b) =>
          supabase.from("rdo_workforce").select("work_id, collaborator_id, report_date, present, worked_hours, position_id, collaborators(position_id)").in("work_id", workIds).range(a, b),
        ),
        supabase.from("work_progress").select("*").in("work_id", workIds).order("month"),
        supabase.from("work_entries").select("*").in("work_id", workIds).order("entry_date", { ascending: false }),
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, salary, full_name, contract_type, city, vt_enabled, travel_bonus_enabled").range(a, b)),
        w.client_id ? supabase.from("works").select("id").eq("client_id", w.client_id) : Promise.resolve({ data: [] as any[] }),
        w.client_id
          ? fetchAll<any>((a, b) =>
              supabase.from("vehicle_schedules").select("schedule_date, km, trips, client_id, work_id, driver_id, driver_bonus, is_suzano_local, vehicles(km_rate, plate), collaborators(full_name)").or(`client_id.eq.${w.client_id},is_suzano_local.eq.true`).range(a, b),
            )
          : Promise.resolve([] as any[]),
        w.client_id
          ? supabase.from("clients").select("name, has_toll, toll_amount, city, distance_km").eq("id", w.client_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      const [workVt, workTravelRows, noVtRows, leaves, vtRules, dbRules, tbRules, cityDist] = await Promise.all([
        // VT é marcado por cliente na Programação: lê de todos os serviços do cliente
        fetchAll<any>((a, b) => supabase.from("schedule_work_vt").select("schedule_id, work_id, pays_vt").in("work_id", [...new Set([...workIds, ...(((siblings as any).data ?? []) as any[]).map((x) => x.id)])]).range(a, b)),
        fetchAll<any>((a, b) => supabase.from("schedule_work_travel").select("schedule_id, work_id, pays_bonus").in("work_id", workIds).range(a, b)),
        fetchAll<any>((a, b) =>
          supabase.from("daily_status_entries").select("schedule_id, collaborator_id")
            .in("box_key", ["falta", "atestado", "medico", "interjornada", "licenca", "abono"]).range(a, b),
        ),
        fetchAll<any>((a, b) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").range(a, b)),
        supabase.from("transport_voucher_rules").select("*").eq("active", true),
        supabase.from("driver_bonus_rules").select("*").eq("active", true),
        supabase.from("travel_bonus_rules").select("*").eq("active", true),
        supabase.from("city_distances").select("city_a, city_b, km"),
      ]);
      const sibIds: string[] = ((siblings as any).data ?? []).map((x: any) => x.id);
      const clientName = (client as any).data?.name as string | undefined;
      const [sibAllocs, sibRdo, integAppts, integBoxes] = await Promise.all([
        sibIds.length
          ? fetchAll<any>((a, b) =>
              supabase.from("daily_allocations").select("work_id, daily_schedules(schedule_date)").in("work_id", sibIds).range(a, b),
            )
          : Promise.resolve([] as any[]),
        sibIds.length
          ? fetchAll<any>((a, b) =>
              supabase.from("rdo_workforce").select("work_id, report_date, present, worked_hours").in("work_id", sibIds).range(a, b),
            )
          : Promise.resolve([] as any[]),
        w.client_id
          ? fetchAll<any>((a, b) =>
              supabase.from("appointments").select("collaborator_id, scheduled_date, completed_date, status, pays_transport_voucher").eq("type", "integracao").eq("client_id", w.client_id!).range(a, b),
            )
          : Promise.resolve([] as any[]),
        clientName
          ? fetchAll<any>((a, b) =>
              supabase.from("daily_status_entries").select("collaborator_id, daily_schedules(schedule_date)").eq("box_key", `integracao:${clientName}`).range(a, b),
            )
          : Promise.resolve([] as any[]),
      ]);
      return {
        allocs,
        sibAllocs,
        sibRdo,
        integAppts,
        integBoxes,
        rdoWf,
        progress: progress.data ?? [],
        // Faturamento com mês de competência: cálculos usam a competência; doc_date guarda a data real
        entries: (entries.data ?? []).map((e: any) =>
          e.category === "faturamento" && e.competence_month && e.competence_month !== String(e.entry_date).slice(0, 7)
            ? { ...e, doc_date: e.entry_date, entry_date: `${e.competence_month}-01` }
            : e,
        ),
        people,
        siblingCount: Math.max(1, (siblings as any).data?.length ?? 1),
        vs,
        client: (client as any).data,
        workVt,
        workTravelRows,
        noVtRows,
        leaves,
        vtRules: vtRules.data ?? [],
        dbRules: dbRules.data ?? [],
        tbRules: tbRules.data ?? [],
        cityDist: cityDist.data ?? [],
      };
}

export type BaseOpts = { isAll: boolean; workIds: string[]; holidays: string[]; allWorks: any[] };

/** Contrato: work_id → último dia do mês do último faturamento (custos depois disso não entram). */
export function contractCutoffs(work: any, entries: any[], isAll: boolean, allWorks?: any[]) {
  const contracts = new Set<string>(
    isAll ? (allWorks ?? []).filter((x: any) => x.contract_enabled).map((x: any) => x.id) : work?.contract_enabled ? [work.id] : [],
  );
  const last = new Map<string, string>();
  for (const e of entries ?? []) {
    if (e.category !== "faturamento" || !contracts.has(e.work_id)) continue;
    const ym = String(e.entry_date).slice(0, 7);
    if (ym > (last.get(e.work_id) ?? "")) last.set(e.work_id, ym);
  }
  return new Map([...last].map(([k, ym]) => [k, monthEnd(ym)]));
}

/** Cálculo base (custos realizados, andamento, receita e margem por mês). */
export function buildBase(work: any, raw: any, fromMonth: string, untilMonth: string, opts: BaseOpts) {
  if (!work || !raw) return null;
  const { isAll, workIds } = opts;
    // Fechamento: do início da obra até o último dia do mês selecionado
    let cut = untilMonth ? monthEnd(untilMonth) : "9999-12-31";
    // HH: realizado só até o último RDO (andamento é automático pelos RDOs)
    if (!isAll && (work as any).hh_enabled) {
      const lastRdo = raw.rdoWf.reduce((m: string, r: any) => (r.report_date > m ? r.report_date : m), "");
      if (lastRdo && lastRdo < cut) cut = lastRdo;
    }
    // Com mês inicial: só o que estiver dentro do período; sem mês inicial: desde o começo da obra
    const from = fromMonth ? `${fromMonth}-01` : "";
    const okDate = (dt?: string | null) => !dt || (dt.slice(0, 10) <= cut && dt.slice(0, 10) >= from);
    // Contrato: custos só até o fim do mês do último faturamento do serviço
    const contractCut = contractCutoffs(work, raw.entries, isAll, opts.allWorks);
    // Demais serviços: custos só até o dia do último andamento (% conclusão) apontado
    {
      const byId = new Map<string, any>((isAll ? opts.allWorks ?? [] : [work]).map((x: any) => [x.id, x]));
      const lastProg = new Map<string, string>();
      for (const p of raw.progress ?? []) {
        const dt = String(p.month).slice(0, 10);
        if (untilMonth && dt > monthEnd(untilMonth)) continue;
        const w = byId.get(p.work_id);
        if (!w || w.contract_enabled || w.hh_enabled || contractCut.has(p.work_id)) continue;
        if (dt > (lastProg.get(p.work_id) ?? "")) lastProg.set(p.work_id, dt);
      }
      for (const [k, dt] of lastProg) contractCut.set(k, dt);
    }
    const okW = (wid: string | null | undefined, dt?: string | null) => {
      if (!okDate(dt)) return false;
      const c = wid ? contractCut.get(wid) : undefined;
      return !c || !dt || dt.slice(0, 10) <= c;
    };
    const d = {
      ...raw,
      allocs: raw.allocs.filter((a: any) => okW(a.work_id, a.daily_schedules?.schedule_date)),
      sibAllocs: raw.sibAllocs.filter((a: any) => okW(a.work_id, a.daily_schedules?.schedule_date)),
      rdoWf: raw.rdoWf.filter((r: any) => okW(r.work_id, r.report_date)),
      sibRdo: (raw.sibRdo ?? []).filter((r: any) => okW(r.work_id, r.report_date)),
      // Carros "Suzano Local" (sem cliente) entram só nos serviços da Suzano
      vs: raw.vs.filter((v: any) => okW(v.work_id, v.schedule_date) && (!v.is_suzano_local || /suzano/i.test(String(raw.client?.name ?? "")))),
      entries: raw.entries.filter((e: any) => e.category === "faturamento" ? okDate(e.entry_date) : okW(e.work_id, e.entry_date)),
      progress: raw.progress.filter((p: any) => !untilMonth || String(p.month).slice(0, 7) <= untilMonth),
    };
    const idSet = new Set(workIds);
    const rate = new Map<string, number>(d.people.map((p: any) => [p.id, Number(p.salary ?? 0)]));
    const pj = new Set<string>(d.people.filter((p: any) => p.contract_type === "pj").map((p: any) => p.id));
    const enc = (id: string) => (pj.has(id) ? 1 : ENCARGOS);
    const rdoKey = new Map<string, any>(d.rdoWf.map((r: any) => [`${r.collaborator_id}|${r.report_date}`, r]));
    const monthly = new Map<string, { labor: number; transport: number; entries: number; billing: number }>();
    const bump = (ym: string, k: "labor" | "transport" | "entries" | "billing", v: number) => {
      const m = monthly.get(ym) ?? { labor: 0, transport: 0, entries: 0, billing: 0 };
      m[k] += v;
      monthly.set(ym, m);
    };
    const seen = new Set<string>();
    const laborBy = new Map<string, { days: number; hours: number; cost: number }>();
    const addLabor = (id: string, hours: number, cost: number) => {
      const l = laborBy.get(id) ?? { days: 0, hours: 0, cost: 0 };
      l.days += 1;
      l.hours += hours;
      l.cost += cost;
      laborBy.set(id, l);
    };
    const hol = new Set<string>((opts.holidays ?? []) as string[]);
    for (const a of d.allocs) {
      const date = a.daily_schedules?.schedule_date as string | undefined;
      if (!date) continue;
      const key = `${a.collaborator_id}|${date}`;
      seen.add(key);
      const r = rdoKey.get(key);
      const hours = r ? (r.present ? Number(r.worked_hours ?? DEFAULT_HOURS) : 0) : DEFAULT_HOURS;
      const cost = laborCost(hours, rate.get(a.collaborator_id) ?? 0, pj.has(a.collaborator_id), date, hol);
      addLabor(a.collaborator_id, hours, cost);
      bump(date.slice(0, 7), "labor", cost);
    }
    for (const r of d.rdoWf) {
      const key = `${r.collaborator_id}|${r.report_date}`;
      if (seen.has(key) || !r.present) continue;
      const hours = Number(r.worked_hours ?? 0);
      const cost = laborCost(hours, rate.get(r.collaborator_id) ?? 0, pj.has(r.collaborator_id), r.report_date, hol);
      addLabor(r.collaborator_id, hours, cost);
      bump(r.report_date.slice(0, 7), "labor", cost);
    }
    const toll = d.client?.has_toll ? Number(d.client.toll_amount ?? 0) : 0;
    const transportRows: { date: string; km: number; trips: number; kmCost: number; toll: number; share: number; mine: number; total: number; direct: boolean }[] = [];
    const dayTotal = new Map<string, number>();
    const dayMine = new Map<string, number>();
    for (const a of d.sibAllocs) {
      const dt = a.daily_schedules?.schedule_date as string | undefined;
      if (!dt) continue;
      dayTotal.set(dt, (dayTotal.get(dt) ?? 0) + 1);
      if (idSet.has(a.work_id)) dayMine.set(dt, (dayMine.get(dt) ?? 0) + 1);
    }
    for (const v of d.vs) {
      if (v.work_id && !idSet.has(v.work_id)) continue;
      const trips = Number(v.trips ?? 1);
      const kmCost = Number(v.km ?? 0) * 2 * trips * Number(v.vehicles?.km_rate ?? KM_RATE);
      const t = v.is_suzano_local ? 0 : toll * 2 * trips;
      const total = dayTotal.get(v.schedule_date) ?? 0;
      const mine = dayMine.get(v.schedule_date) ?? 0;
      const share = v.work_id ? kmCost + t : total > 0 ? ((kmCost + t) * mine) / total : 0;
      if (!share) continue;
      transportRows.push({ date: v.schedule_date, km: Number(v.km ?? 0), trips, kmCost, toll: t, share, mine, total, direct: !!v.work_id });
      bump(v.schedule_date.slice(0, 7), "transport", share);
    }
    // VT dos colaboradores escalados neste serviço entra no transporte da obra
    const person = new Map<string, any>(d.people.map((p: any) => [p.id, p]));
    // Marcação de VT vale para o cliente no dia (qualquer serviço do cliente marcado)
    const workVt = new Map<string, boolean>();
    for (const r of (d.workVt ?? []) as any[]) if (r.pays_vt) workVt.set(r.schedule_id, true);
    const noVt = new Set<string>((d.noVtRows ?? []).map((r: any) => `${r.schedule_id}|${r.collaborator_id}`));
    const vtDay = (driver: boolean) =>
      (d.vtRules ?? []).reduce((sum: number, r: any) => {
        if (driver && !r.applies_to_drivers) return sum;
        if (!driver && !r.applies_to_collaborators) return sum;
        if (r.calculation_type === "fixed_monthly") return sum;
        return sum + Number(r.amount) * (r.calculation_type === "round_trip" ? 2 : 1);
      }, 0);
    const vtByDate = new Map<string, { people: number; cost: number }>();
    for (const a of d.allocs) {
      const date = a.daily_schedules?.schedule_date as string | undefined;
      if (!date || noVt.has(`${a.schedule_id}|${a.collaborator_id}`)) continue;
      if ((d.leaves ?? []).some((l: any) => l.collaborator_id === a.collaborator_id && l.start_date <= date && l.end_date >= date)) continue;
      const p = person.get(a.collaborator_id);
      const pouso = String(p?.city ?? "").toLowerCase().includes("pouso alegre");
      const base = p?.vt_enabled === false ? false : !!workVt.get(`${a.schedule_id}|${a.work_id}`) || pouso;
      if (!(a.vt_override ?? base)) continue;
      const cost = vtDay(!!a.driver);
      if (!cost) continue;
      const v = vtByDate.get(date) ?? { people: 0, cost: 0 };
      v.people += 1;
      v.cost += cost;
      vtByDate.set(date, v);
      bump(date.slice(0, 7), "transport", cost);
    }
    // Integração no cliente: dia de integração (seg–qui 9h, sex 8h) × valor hora × encargos + VT + prêmio viagem,
    // rateado entre os serviços do cliente pelas horas trabalhadas (RDO)
    const integTravel = new Map<string, number>();
    {
      // Rateio por mês: só serviços com horas de RDO no mês da integração recebem parte.
      const allByM = new Map<string, number>();
      const myByM = new Map<string, number>();
      for (const r of d.sibRdo ?? []) {
        if (!r.present || !r.report_date) continue;
        const m = String(r.report_date).slice(0, 7);
        const h = Number(r.worked_hours ?? 0);
        allByM.set(m, (allByM.get(m) ?? 0) + h);
        if (idSet.has(r.work_id)) myByM.set(m, (myByM.get(m) ?? 0) + h);
      }
      const shareOf = (date: string) => {
        const m = date.slice(0, 7);
        const all = allByM.get(m) ?? 0;
        return all > 0 ? (myByM.get(m) ?? 0) / all : 0;
      };
      const days = new Map<string, { id: string; date: string; paysVt: boolean }>();
      for (const a of raw.integAppts ?? []) {
        if (a.status === "cancelled" || a.status === "canceled") continue;
        const dt = String(a.completed_date ?? a.scheduled_date ?? "").slice(0, 10);
        if (dt && okDate(dt)) days.set(`${a.collaborator_id}|${dt}`, { id: a.collaborator_id, date: dt, paysVt: a.pays_transport_voucher !== false });
      }
      for (const e of raw.integBoxes ?? []) {
        const dt = e.daily_schedules?.schedule_date as string | undefined;
        if (dt && okDate(dt) && !days.has(`${e.collaborator_id}|${dt}`)) days.set(`${e.collaborator_id}|${dt}`, { id: e.collaborator_id, date: dt, paysVt: true });
      }
      const rIn = (r: any, km: number) => km >= Number(r.minimum_distance ?? 0) && km <= (r.maximum_distance === null ? Infinity : Number(r.maximum_distance));
      const distF = buildDistanceLookup(d.cityDist ?? []);
      const vtCost = vtDay(false);
      for (const { id, date, paysVt } of days.values()) {
        const wd = new Date(`${date}T12:00:00`).getDay();
        const hours = wd >= 1 && wd <= 4 ? 9 : 8;
        const shareF = shareOf(date);
        if (!shareF) continue;
        const mo = hours * (rate.get(id) ?? 0) * enc(id) * shareF;
        const p = person.get(id);
        const vt = !paysVt || p?.vt_enabled === false ? 0 : vtCost * shareF;
        const dist = distF(p?.city, d.client?.city ?? (work as any).city, Number(d.client?.distance_km ?? (work as any).distance_km ?? 0));
        const tb = p?.travel_bonus_enabled === false ? 0
          : (d.tbRules ?? []).filter((x: any) => rIn(x, dist)).reduce((s: number, x: any) => s + Number(x.bonus_amount) * (x.calculation_type === "round_trip" ? 2 : 1), 0) * shareF;
        if (mo) { addLabor(id, hours * shareF, mo); bump(date.slice(0, 7), "labor", mo); }
        if (vt) {
          const v = vtByDate.get(date) ?? { people: 0, cost: 0 };
          v.cost += vt;
          v.people += 1;
          vtByDate.set(date, v);
          bump(date.slice(0, 7), "transport", vt);
        }
        if (tb) { integTravel.set(date, (integTravel.get(date) ?? 0) + tb); bump(date.slice(0, 7), "transport", tb); }
      }
    }
    const vtRows = [...vtByDate.entries()].map(([date, v]) => ({ date, ...v })).sort((x, y) => x.date.localeCompare(y.date));
    const vtTotal = vtRows.reduce((s, r) => s + r.cost, 0);
    // Prêmio motorista: regras da aba Prêmio de Motorista, rateado como o veículo
    const inRule = (r: any, km: number) => km >= Number(r.minimum_distance ?? 0) && km <= (r.maximum_distance === null ? Infinity : Number(r.maximum_distance));
    const driverRows: { date: string; driver: string; plate: string; km: number; amount: number; share: number }[] = [];
    const bonusSeen = new Set<string>(); // 1 prêmio por motorista por dia, mesmo com várias viagens
    for (const v of d.vs) {
      if (!v.driver_bonus || !v.driver_id || (v.work_id && !idSet.has(v.work_id))) continue;
      const bk = `${v.driver_id}|${v.schedule_date}`;
      if (bonusSeen.has(bk)) continue;
      bonusSeen.add(bk);
      const km = Number(v.km ?? 0);
      const amount = (d.dbRules ?? []).filter((r: any) => r.calculation_type !== "fixed_monthly" && inRule(r, km)).reduce((s: number, r: any) => s + Number(r.amount), 0);
      if (!amount) continue;
      const total = dayTotal.get(v.schedule_date) ?? 0;
      const mine = dayMine.get(v.schedule_date) ?? 0;
      const share = v.work_id ? amount : total > 0 ? (amount * mine) / total : 0;
      if (!share) continue;
      driverRows.push({ date: v.schedule_date, driver: v.collaborators?.full_name ?? "—", plate: v.vehicles?.plate ?? "—", km, amount, share });
      bump(v.schedule_date.slice(0, 7), "transport", share);
    }
    const driverTotal = driverRows.reduce((s, r) => s + r.share, 0);
    // Prêmio viagem: distância cidade do colaborador → cidade da obra, regras da aba Prêmio de Viagem
    const distFor = buildDistanceLookup(d.cityDist ?? []);
    const travelByDate = new Map<string, { people: number; cost: number }>();
    const travelSeen = new Set<string>();
    const travelWorkMap = new Map<string, boolean>((d.workTravelRows ?? []).map((v: any) => [`${v.schedule_id}|${v.work_id}`, v.pays_bonus]));
    for (const a of d.allocs) {
      const date = a.daily_schedules?.schedule_date as string | undefined;
      if (!date || noVt.has(`${a.schedule_id}|${a.collaborator_id}`)) continue;
      const key = `${a.collaborator_id}|${date}`;
      if (travelSeen.has(key)) continue;
      travelSeen.add(key);
      const r = rdoKey.get(key);
      if (r && !r.present) continue;
      const p = person.get(a.collaborator_id);
      const travelOn = a.travel_bonus_override ?? ((travelWorkMap.get(`${a.schedule_id}|${a.work_id}`) ?? (d.tbRules ?? []).some((x: any) => inRule(x, Number(d.client?.distance_km ?? (work as any).distance_km ?? 0)))));
      if (!travelOn) continue;
      const dist = distFor(p?.city, d.client?.city ?? (work as any).city, Number(d.client?.distance_km ?? (work as any).distance_km ?? 0));
      const cost = (d.tbRules ?? []).filter((x: any) => inRule(x, dist)).reduce((s: number, x: any) => s + Number(x.bonus_amount) * (x.calculation_type === "round_trip" ? 2 : 1), 0);
      if (!cost) continue;
      const t = travelByDate.get(date) ?? { people: 0, cost: 0 };
      t.people += 1;
      t.cost += cost;
      travelByDate.set(date, t);
      bump(date.slice(0, 7), "transport", cost);
    }
    for (const [date, c] of integTravel) {
      const t = travelByDate.get(date) ?? { people: 0, cost: 0 };
      t.cost += c;
      travelByDate.set(date, t);
    }
    const travelRows = [...travelByDate.entries()].map(([date, v]) => ({ date, ...v })).sort((x, y) => x.date.localeCompare(y.date));
    const travelTotal = travelRows.reduce((s, r) => s + r.cost, 0);
    driverRows.sort((a, b) => a.date.localeCompare(b.date));
    for (const e of d.entries) {
      bump(e.entry_date.slice(0, 7), e.category === "faturamento" ? "billing" : "entries", Number(e.amount));
    }
    let progMap = new Map<string, number>(d.progress.map((p: any) => [String(p.month).slice(0, 7), Number(p.percent)]));
    if (!isAll && (work as any).contract_enabled) {
      // Contrato: andamento mensal automático = faturamentos acumulados ÷ meses
      const bills = d.entries.filter((e: any) => e.category === "faturamento").map((e: any) => e.entry_date.slice(0, 7)).sort();
      progMap = new Map();
      bills.forEach((ym: string, i: number) => progMap.set(ym, contractFraction(i + 1, Number((work as any).contract_months ?? 12)) * 100));
    }
    if (!isAll && (work as any).hh_enabled) {
      // HH: andamento automático = valor HH acumulado dos RDOs (horas × valor hora cobrado) ÷ valor total do pedido
      const rates = ((work as any).hh_rates ?? {}) as Record<string, number>;
      const ord = Number(work.order_value ?? 0);
      const byYm = new Map<string, number>();
      for (const r of raw.rdoWf as any[]) {
        if (!r.present || r.report_date > cut) continue;
        const pid = r.position_id ?? r.collaborators?.position_id ?? "none";
        const ym = r.report_date.slice(0, 7);
        byYm.set(ym, (byYm.get(ym) ?? 0) + Number(r.worked_hours ?? 0) * Number(rates[pid] ?? 0));
      }
      progMap = new Map();
      let acc = 0;
      for (const ym of [...byYm.keys()].sort()) {
        acc += byYm.get(ym)!;
        progMap.set(ym, ord ? Math.min(100, (acc / ord) * 100) : 0);
      }
    }
    if (isAll) {
      // Andamento geral = média ponderada pelo valor do pedido de cada serviço
      const ow: Record<string, number> = (work as any)._orders ?? {};
      const totalOrder = Object.values(ow).reduce((a, b) => a + b, 0);
      // Serviços Contrato: andamento vem dos faturamentos (não da tabela manual)
      const ctWorks = new Map<string, number>(
        (opts.allWorks ?? []).filter((x: any) => workIds.includes(x.id) && x.contract_enabled).map((x: any) => [x.id, Number(x.contract_months ?? 12)]),
      );
      // Serviços HH: andamento automático = valor HH acumulado dos RDOs ÷ pedido
      const hhWorks = new Map<string, any>((opts.allWorks ?? []).filter((x: any) => workIds.includes(x.id) && x.hh_enabled && !x.contract_enabled).map((x: any) => [x.id, x]));
      const progEv: { ym: string; id: string; pc: number }[] = d.progress
        .filter((p: any) => !ctWorks.has(p.work_id) && !hhWorks.has(p.work_id))
        .map((p: any) => ({ ym: String(p.month).slice(0, 7), id: p.work_id, pc: Number(p.percent) }));
      for (const [id, months] of ctWorks) {
        const bills = d.entries.filter((e: any) => e.work_id === id && e.category === "faturamento").map((e: any) => e.entry_date.slice(0, 7)).sort();
        bills.forEach((ym: string, i: number) => progEv.push({ ym, id, pc: contractFraction(i + 1, months) * 100 }));
      }
      for (const [id, hw] of hhWorks) {
        const rates = (hw.hh_rates ?? {}) as Record<string, number>;
        const ord = Number(ow[id] ?? hw.order_value ?? 0);
        const byYm = new Map<string, number>();
        for (const r of raw.rdoWf as any[]) {
          if (r.work_id !== id || !r.present || r.report_date > cut) continue;
          const pid = r.position_id ?? r.collaborators?.position_id ?? "none";
          byYm.set(r.report_date.slice(0, 7), (byYm.get(r.report_date.slice(0, 7)) ?? 0) + Number(r.worked_hours ?? 0) * Number(rates[pid] ?? 0));
        }
        let acc = 0;
        for (const ym of [...byYm.keys()].sort()) { acc += byYm.get(ym)!; progEv.push({ ym, id, pc: ord ? Math.min(100, (acc / ord) * 100) : 0 }); }
      }
      progEv.sort((a, b) => a.ym.localeCompare(b.ym));
      const pm = [...new Set(progEv.map((p) => p.ym))];
      const lastBy = new Map<string, number>();
      progMap = new Map();
      for (const ym of pm) {
        progEv.filter((p) => p.ym === ym).forEach((p) => lastBy.set(p.id, p.pc));
        const val = totalOrder
          ? [...lastBy.entries()].reduce((a, [id, pc]) => a + pc * (ow[id] ?? 0), 0) / totalOrder
          : [...lastBy.values()].reduce((a, b) => a + b, 0) / Math.max(1, workIds.length);
        progMap.set(ym, val);
      }
    }
    const months = [...new Set([...monthly.keys(), ...progMap.keys()])].filter((ym) => !fromMonth || ym >= fromMonth).sort();
    // Valor do pedido: sempre o informado em Dados do Cliente (HH ou não)
    const order = Number(work.order_value ?? 0);
    const biRaw = ((work as any).budget_items ?? {}) as Record<string, number>;
    const bdiOn = !isAll && Number(biRaw["bdi"] ?? 0) === 1;
    const budget = bdiOn ? order * BDI_RATE : Number(work.budget_cost ?? 0);
    const budgetMarginPct = order ? ((order - order * TAX_RATE - budget) / order) * 100 : 0;
    // Com mês inicial: receita só do avanço dentro do período (desconta o andamento anterior)
    const pStart = fromMonth || "";
    const basePct = pStart ? [...progMap.entries()].filter(([ym]) => ym < pStart).sort(([a], [b]) => a.localeCompare(b)).pop()?.[1] ?? 0 : 0;
    let accCost = 0;
    let lastPct = basePct;
    let accBilling = 0;
    const rows = months.map((ym) => {
      const m = monthly.get(ym) ?? { labor: 0, transport: 0, entries: 0, billing: 0 };
      accCost += m.labor + m.transport + m.entries;
      accBilling += m.billing;
      const prev = lastPct;
      if (progMap.has(ym)) lastPct = progMap.get(ym)!;
      const revenue = (order * Math.max(0, lastPct - basePct)) / 100;
      const margin = revenue - revenue * TAX_RATE - accCost;
      const marginPct = revenue ? (margin / revenue) * 100 : 0;
      return {
        ym,
        label: monthLabel(ym),
        progress: lastPct,
        advance: lastPct - prev,
        revenue,
        cost: accCost,
        monthCost: m.labor + m.transport + m.entries,
        labor: m.labor,
        monthBilling: m.billing,
        transport: m.transport,
        others: m.entries,
        margin,
        marginPct,
        consumed: budget ? (accCost / budget) * 100 : 0,
        budgetMarginPct,
        billing: accBilling,
      };
    });
    const last = rows[rows.length - 1];
    const tot = { labor: 0, transport: 0, others: 0 };
    rows.forEach((r) => {
      tot.labor += r.labor;
      tot.transport += r.transport;
      tot.others += r.others;
    });
    const real: Record<ItemKey, number> = { mo: tot.labor, transporte: tot.transport, ferramentas: 0, materiais: 0, andaimes: 0 };
    const perMonth = new Map<string, Record<ItemKey, number>>();
    rows.forEach((r) => perMonth.set(r.ym, { mo: r.labor, transporte: r.transport, ferramentas: 0, materiais: 0, andaimes: 0 }));
    for (const e of d.entries) {
      const k = entryItem(e.category);
      if (!k) continue;
      real[k] += Number(e.amount);
      const pm = perMonth.get(e.entry_date.slice(0, 7));
      if (pm) pm[k] += Number(e.amount);
    }
    const monthBars = rows.map((r) => {
      const pm = perMonth.get(r.ym)!;
      return { label: r.label, ...pm, materiais: pm.materiais + pm.ferramentas + pm.andaimes, faturamento: r.monthBilling };
    });
    // Custos BDI ativos: orçado recalculado automaticamente sobre o pedido atual
    const bi = bdiOn ? bdiBudget(order, real, biRaw) : biRaw;
    const items = ITEMS.map((it) => {
      const b = Number(bi[it.key] ?? 0);
      const r = real[it.key];
      return { key: it.key, label: it.label, budget: b, real: r, used: b ? (r / b) * 100 : r ? 100 : 0 };
    });
    let budgetOut = budget;
    let budgetMarginOut = budgetMarginPct;
    if (!isAll && (work as any).hh_enabled) {
      // HH: materiais e ferramentas não entram no custo orçado
      for (const it of items) if (it.key === "materiais" || it.key === "ferramentas") it.budget = 0;
      if (bdiOn) {
        // BDI: o total orçado continua pedido × BDI (margem orçada ~23%), repartido entre os itens restantes
        const rest = items.reduce((a, i) => a + i.budget, 0);
        if (rest > 0) for (const it of items) it.budget = Math.round(((it.budget * order * BDI_RATE) / rest) * 100) / 100;
      }
      for (const it of items) it.used = it.budget ? (it.real / it.budget) * 100 : it.real ? 100 : 0;
      budgetOut = items.reduce((a, i) => a + i.budget, 0);
      budgetMarginOut = order ? ((order - order * TAX_RATE - budgetOut) / order) * 100 : 0;
      for (const r of rows) { r.consumed = budgetOut ? (r.cost / budgetOut) * 100 : 0; r.budgetMarginPct = budgetMarginOut; }
    }
    const dates = [
      ...d.allocs.map((a: any) => a.daily_schedules?.schedule_date).filter(Boolean),
      ...d.rdoWf.map((r: any) => r.report_date),
    ].sort() as string[];
    const first = dates[0];
    const lastDay = dates[dates.length - 1];
    const days = first ? Math.round((Date.parse(lastDay!) - Date.parse(first)) / 86400000) + 1 : 0;
    const names = new Map<string, string>(d.people.map((p: any) => [p.id, p.full_name]));
    const laborRows = [...laborBy.entries()]
      .map(([id, l]) => ({ id, name: `${names.get(id) ?? "—"}${pj.has(id) ? " (PJ)" : ""}`, rate: rate.get(id) ?? 0, ...l }))
      .sort((a, b) => b.cost - a.cost);
    transportRows.sort((a, b) => a.date.localeCompare(b.date));
    const billingCount = d.entries.filter((e: any) => e.category === "faturamento").length;
    return { rows, last, order, budget: budgetOut, budgetMarginPct: budgetMarginOut, tot, items, monthBars, first, lastDay, days, laborRows, transportRows, vtRows, vtTotal, driverRows, driverTotal, travelRows, travelTotal, siblingCount: d.siblingCount, billingCount };
}

export const BDI_RATE = 0.5885;
/** Custos BDI: total = pedido × 0,5885, pesos 4/2/1/3 (MO/transp./ferram./mat.); com custos realizados,
 * metade padrão e metade proporcional ao realizado; com andaime e sem ferramentas, ferramentas vira andaimes. */
export function bdiBudget(order: number, realIn: Partial<Record<string, number>>, saved?: Record<string, any>): Record<string, number> {
  // Item zerado manualmente com BDI ativo fica fora do orçado (não é redistribuído)
  const zeroed = new Set(["mo", "transporte", "ferramentas", "materiais"].filter((k) => saved && saved[k] != null && Number(saved[k]) === 0));
  const real = Object.fromEntries(ITEMS.map((it) => [it.key, Math.max(0, Number(realIn[it.key] ?? 0) || 0)])) as Record<string, number>;
  const w: Record<string, number> = { mo: 4, transporte: 2, ferramentas: 1, materiais: 3, andaimes: 0 };
  if ((real["andaimes"] ?? 0) > 0 && !(real["ferramentas"] ?? 0)) { w["andaimes"] = w["ferramentas"]!; w["ferramentas"] = 0; }
  const realTotal = ITEMS.reduce((a, it) => a + (real[it.key] ?? 0), 0);
  if (realTotal > 0) for (const it of ITEMS) w[it.key] = 0.5 * w[it.key]! + 0.5 * (10 * (real[it.key] ?? 0)) / realTotal;
  const sumW = ITEMS.reduce((a, it) => a + w[it.key]!, 0) || 1;
  const total = order * BDI_RATE;
  return Object.fromEntries(ITEMS.map((it) => [it.key, zeroed.has(it.key) ? 0 : Math.round(((total * w[it.key]!) / sumW) * 100) / 100]));
}

/** Custos orçados ajustados como em Resultados (Faturamento Parcial, Mensal). */
export function adjustedItems(work: any, base: NonNullable<ReturnType<typeof buildBase>>, raw: any) {
  void raw;
  let items = base.items.map((i) => ({ ...i }));
  if (work.contract_enabled) {
    const f = contractFraction(base.billingCount, Number(work.contract_months ?? 12));
    items = items.map((i) => ({ ...i, budget: i.budget * f }));
  }
  if (work.monthly_enabled) {
    const total = ((Array.isArray(work.orders) ? work.orders : []) as any[]).reduce((a, o) => a + Number(o.value ?? 0), 0);
    const pctBy: Partial<Record<ItemKey, number>> = { mo: 0.5, transporte: 0.1, materiais: 0.03 };
    items = items.map((i) => ({ ...i, budget: total * (pctBy[i.key as ItemKey] ?? 0) }));
  }
  return items.map((i) => ({ ...i, used: i.budget ? (i.real / i.budget) * 100 : i.real ? 100 : 0 }));
}

/** Margem total (acumulada) como em Resultados. */
export function totalMargin(work: any, full: NonNullable<ReturnType<typeof buildBase>>) {
  if (!full.last) return { margin: 0, pct: 0 };
  if (work.monthly_enabled) {
    const list = ((Array.isArray(work.orders) ? work.orders : []) as any[]).filter((o) => o.date);
    const months = new Set(list.map((o) => String(o.date).slice(0, 7)));
    const revenue = list.reduce((a, o) => a + Number(o.value ?? 0), 0);
    const cost = full.rows.filter((r) => months.has(r.ym)).reduce((a, r) => a + r.monthCost, 0);
    const margin = revenue * (1 - TAX_RATE) - cost;
    return { margin, pct: revenue ? (margin / revenue) * 100 : 0 };
  }
  const margin = full.last.revenue * (1 - TAX_RATE) - full.last.cost;
  return { margin, pct: full.last.revenue ? (margin / full.last.revenue) * 100 : 0 };
}

/** Andamento (%) até o mês informado, como em Resultados. */
export function progressUntil(work: any, full: NonNullable<ReturnType<typeof buildBase>>, untilYm: string) {
  if (work.contract_enabled) return contractFraction(full.billingCount, Number(work.contract_months ?? 12)) * 100;
  const r = full.rows.filter((x) => x.ym <= untilYm).pop();
  return r?.progress ?? 0;
}

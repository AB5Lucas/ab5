import { Switch } from "@/components/ui/switch";
import { useMemo, useState } from "react";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";

import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ServiceDaysCalendar } from "@/components/service-days-calendar";
import { buildDistanceLookup } from "@/lib/city-distance";

export const Route = createFileRoute("/_authenticated/obras/resultado")({
  head: () => ({
    meta: [
      { title: "Resultados | AB5 Hub" },
      { name: "description", content: "Margem de contribuição proporcional ao andamento de cada serviço." },
      { property: "og:title", content: "Resultados | AB5 Hub" },
      { property: "og:description", content: "Receita proporcional, custo realizado e margem por serviço." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResultadoPage,
});

/** Multiplicador de encargos sobre o valor hora do colaborador. */
import { laborCost, ENCARGOS } from "@/lib/labor-cost";
const TAX_RATE = 0.1867; // imposto fixo sobre o valor do pedido
const KM_RATE = 1.35;
const DEFAULT_HOURS = 8;

const CATEGORIES = [
  { key: "mao_obra", label: "Mão de obra" },
  { key: "materiais", label: "Materiais" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "andaimes", label: "Andaimes" },
  { key: "terceiros", label: "Transporte de terceiros" },
  { key: "faturamento", label: "Faturamento" },
] as const;
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

/** Itens de custo orçados/realizados. */
const ITEMS = [
  { key: "mo", label: "Mão de obra" },
  { key: "transporte", label: "Transporte" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "materiais", label: "Materiais" },
  { key: "andaimes", label: "Andaimes" },
] as const;
type ItemKey = (typeof ITEMS)[number]["key"];
const entryItem = (cat: string): ItemKey | null =>
  cat === "mao_obra" ? "mo" : cat === "terceiros" ? "transporte" : cat === "ferramentas" || cat === "materiais" || cat === "andaimes" ? cat : null;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (s: string) => {
  const t = String(s).replace(/[^\d,.-]/g, "");
  // "1.234,56" → 1234.56 ; "12.5" (sem vírgula) → 12.5
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(n) || 0;
};
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
};
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y!, m!, 0).getDate()).padStart(2, "0")}`;
};
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function ResultadoPage() {
  const { canWrite, role, user } = useCurrentUser();
  const qc = useQueryClient();
  const [workId, setWorkId] = useState<string>("");
  const [clientKey, setClientKey] = useState<string>("");
  const [fromMonth, setFromMonth] = useState<string>("");
  const [toMonth, setToMonth] = useState<string>("");
  // Cálculos consideram tudo até o fim do período escolhido
  const untilMonth = toMonth;
  const hasPeriod = !!(fromMonth || toMonth);
  const periodStart = fromMonth ? `${fromMonth}-01` : "0000-01-01";
  const periodEnd = toMonth ? monthEnd(toMonth) : "9999-12-31";
  const activeIds = useQuery({
    queryKey: ["works-active-period", periodStart, periodEnd],
    enabled: hasPeriod,
    queryFn: async () => {
      const scheds = await fetchAll<any>((a, b) =>
        supabase.from("daily_schedules").select("id").gte("schedule_date", periodStart).lte("schedule_date", periodEnd).order("id").range(a, b));
      const ids = scheds.map((x) => x.id);
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const rows = await fetchAll<any>((a, b) =>
          supabase.from("daily_allocations").select("work_id").in("schedule_id", chunk).order("id").range(a, b));
        rows.forEach((r) => out.add(r.work_id));
      }
      const [rdoRows, entryRows] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("rdos").select("work_id").gte("report_date", periodStart).lte("report_date", periodEnd).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id").gte("entry_date", periodStart).lte("entry_date", periodEnd).order("id").range(a, b)),
      ]);
      rdoRows.forEach((r) => r.work_id && out.add(r.work_id));
      entryRows.forEach((r) => r.work_id && out.add(r.work_id));
      return out;
    },
  });

  const works = useQuery({
    queryKey: ["works-result", role, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("works").select("*, clients(name)").order("name");
      if (error) throw error;
      // Coordenador só vê as obras atribuídas a ele na aba Usuários
      if (role === "coordenador" || role === "encarregado") {
        const { data: mine } = await supabase.from("foreman_works").select("work_id").eq("user_id", user!.id);
        const ids = new Set((mine ?? []).map((m) => m.work_id));
        const clients = new Set(data.filter((w) => ids.has(w.id) && w.client_id).map((w) => w.client_id));
        return data.filter((w) => ids.has(w.id) || (w.client_id && clients.has(w.client_id)));
      }
      return data;
    },
  });
  // Com período: enquanto carrega, não mostra nada (evita listar todas as obras por engano)
  const visibleWorks = useMemo(
    () => (hasPeriod ? (activeIds.data ? (works.data ?? []).filter((w) => activeIds.data!.has(w.id)) : []) : works.data ?? []),
    [works.data, activeIds.data, hasPeriod],
  );
  const ALL = "__all__";
  const isAll = workId === ALL;
  const groupKey = (x: any) => x.client_id ?? `n:${x.client ?? "Sem cliente"}`;
  const work = useMemo(() => {
    const list = visibleWorks;
    if (!isAll) return list.find((w) => w.id === workId);
    const g = list.filter((x) => groupKey(x) === clientKey);
    if (!g.length) return undefined;
    const bi: Record<string, number> = {};
    g.forEach((x: any) => Object.entries(x.budget_items ?? {}).forEach(([k, v]) => (bi[k] = (bi[k] ?? 0) + Number(v ?? 0))));
    return {
      ...g[0]!,
      id: ALL,
      name: "Todos os serviços (resultado geral)",
      order_number: g.map((x) => x.order_number).filter(Boolean).join(", "),
      quote_number: g.map((x) => x.quote_number).filter(Boolean).join(", "),
      order_value: g.reduce((a, x) => a + Number(x.order_value ?? 0), 0),
      budget_cost: g.reduce((a, x) => a + Number(x.budget_cost ?? 0), 0),
      budget_items: bi,
      orders: g.flatMap((x: any) => (Array.isArray(x.orders) ? x.orders : [])),
      _ids: g.map((x) => x.id),
      _orders: Object.fromEntries(g.map((x) => [x.id, Number(x.order_value ?? 0)])),
    } as any;
  }, [visibleWorks, workId, clientKey, isAll]);
  const workIds: string[] = work ? ((work as any)._ids ?? [work.id]) : [];
  const canEdit = canWrite && !isAll;

  const data = useQuery({
    queryKey: ["work-result", workId, workIds.join(","), "vt"],
    enabled: !!work,
    queryFn: async () => {
      const w = work!;
      const [allocs, rdoWf, progress, entries, people, siblings, vs, client] = await Promise.all([
        fetchAll<any>((a, b) =>
          supabase.from("daily_allocations").select("work_id, collaborator_id, schedule_id, driver, vt_override, travel_bonus_override, daily_schedules(schedule_date)").in("work_id", workIds).range(a, b),
        ),
        fetchAll<any>((a, b) =>
          supabase.from("rdo_workforce").select("work_id, collaborator_id, report_date, present, worked_hours").in("work_id", workIds).range(a, b),
        ),
        supabase.from("work_progress").select("*").in("work_id", workIds).order("month"),
        supabase.from("work_entries").select("*").in("work_id", workIds).order("entry_date", { ascending: false }),
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, salary, full_name, contract_type, city, vt_enabled, travel_bonus_enabled").range(a, b)),
        w.client_id ? supabase.from("works").select("id").eq("client_id", w.client_id) : Promise.resolve({ data: [] as any[] }),
        w.client_id
          ? fetchAll<any>((a, b) =>
              supabase.from("vehicle_schedules").select("schedule_date, km, trips, client_id, work_id, driver_id, driver_bonus, vehicles(km_rate, plate), collaborators(full_name)").eq("client_id", w.client_id!).range(a, b),
            )
          : Promise.resolve([] as any[]),
        w.client_id
          ? supabase.from("clients").select("has_toll, toll_amount, city, distance_km").eq("id", w.client_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      const [workVt, workTravelRows, noVtRows, leaves, vtRules, dbRules, tbRules, cityDist] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("schedule_work_vt").select("schedule_id, work_id, pays_vt").in("work_id", workIds).range(a, b)),
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
      const sibAllocs = sibIds.length
        ? await fetchAll<any>((a, b) =>
            supabase.from("daily_allocations").select("work_id, daily_schedules(schedule_date)").in("work_id", sibIds).range(a, b),
          )
        : [];
      return {
        allocs,
        sibAllocs,
        rdoWf,
        progress: progress.data ?? [],
        entries: entries.data ?? [],
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
    },
  });

  const holidaysQ = useQuery({
    queryKey: ["holidays-dates"],
    queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string),
  });
  // ---------- Cálculos ----------
  const calc = useMemo(() => {
    if (!work || !data.data) return null;
    const raw = data.data;
    // Fechamento: do início da obra até o último dia do mês selecionado
    const cut = untilMonth ? monthEnd(untilMonth) : "9999-12-31";
    const okDate = (dt?: string | null) => !dt || dt.slice(0, 10) <= cut;
    const d = {
      ...raw,
      allocs: raw.allocs.filter((a: any) => okDate(a.daily_schedules?.schedule_date)),
      sibAllocs: raw.sibAllocs.filter((a: any) => okDate(a.daily_schedules?.schedule_date)),
      rdoWf: raw.rdoWf.filter((r: any) => okDate(r.report_date)),
      vs: raw.vs.filter((v: any) => okDate(v.schedule_date)),
      entries: raw.entries.filter((e: any) => okDate(e.entry_date)),
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
    const hol = new Set<string>((holidaysQ.data ?? []) as string[]);
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
      const t = toll * 2 * trips;
      const total = dayTotal.get(v.schedule_date) ?? 0;
      const mine = dayMine.get(v.schedule_date) ?? 0;
      const share = v.work_id ? kmCost + t : total > 0 ? ((kmCost + t) * mine) / total : (kmCost + t) / d.siblingCount;
      transportRows.push({ date: v.schedule_date, km: Number(v.km ?? 0), trips, kmCost, toll: t, share, mine, total, direct: !!v.work_id });
      bump(v.schedule_date.slice(0, 7), "transport", share);
    }
    // VT dos colaboradores escalados neste serviço entra no transporte da obra
    const person = new Map<string, any>(d.people.map((p: any) => [p.id, p]));
    const workVt = new Map<string, boolean>((d.workVt ?? []).map((r: any) => [`${r.schedule_id}|${r.work_id}`, r.pays_vt]));
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
    const vtRows = [...vtByDate.entries()].map(([date, v]) => ({ date, ...v })).sort((x, y) => x.date.localeCompare(y.date));
    const vtTotal = vtRows.reduce((s, r) => s + r.cost, 0);
    // Prêmio motorista: regras da aba Prêmio de Motorista, rateado como o veículo
    const inRule = (r: any, km: number) => km >= Number(r.minimum_distance ?? 0) && km <= (r.maximum_distance === null ? Infinity : Number(r.maximum_distance));
    const driverRows: { date: string; driver: string; plate: string; km: number; amount: number; share: number }[] = [];
    for (const v of d.vs) {
      if (!v.driver_bonus || !v.driver_id || (v.work_id && !idSet.has(v.work_id))) continue;
      const km = Number(v.km ?? 0);
      const amount = (d.dbRules ?? []).filter((r: any) => r.calculation_type !== "fixed_monthly" && inRule(r, km)).reduce((s: number, r: any) => s + Number(r.amount), 0);
      if (!amount) continue;
      const total = dayTotal.get(v.schedule_date) ?? 0;
      const mine = dayMine.get(v.schedule_date) ?? 0;
      const share = v.work_id ? amount : total > 0 ? (amount * mine) / total : amount / d.siblingCount;
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
    const travelRows = [...travelByDate.entries()].map(([date, v]) => ({ date, ...v })).sort((x, y) => x.date.localeCompare(y.date));
    const travelTotal = travelRows.reduce((s, r) => s + r.cost, 0);
    driverRows.sort((a, b) => a.date.localeCompare(b.date));
    for (const e of d.entries) {
      bump(e.entry_date.slice(0, 7), e.category === "faturamento" ? "billing" : "entries", Number(e.amount));
    }
    let progMap = new Map<string, number>(d.progress.map((p: any) => [String(p.month).slice(0, 7), Number(p.percent)]));
    if (isAll) {
      // Andamento geral = média ponderada pelo valor do pedido de cada serviço
      const ow: Record<string, number> = (work as any)._orders ?? {};
      const totalOrder = Object.values(ow).reduce((a, b) => a + b, 0);
      const pm = [...new Set(d.progress.map((p: any) => String(p.month).slice(0, 7)))].sort() as string[];
      const lastBy = new Map<string, number>();
      progMap = new Map();
      for (const ym of pm) {
        d.progress.filter((p: any) => String(p.month).slice(0, 7) === ym).forEach((p: any) => lastBy.set(p.work_id, Number(p.percent)));
        const val = totalOrder
          ? [...lastBy.entries()].reduce((a, [id, pc]) => a + pc * (ow[id] ?? 0), 0) / totalOrder
          : [...lastBy.values()].reduce((a, b) => a + b, 0) / Math.max(1, workIds.length);
        progMap.set(ym, val);
      }
    }
    const months = [...new Set([...monthly.keys(), ...progMap.keys()])].sort();
    const order = Number(work.order_value ?? 0);
    const budget = Number(work.budget_cost ?? 0);
    const budgetMarginPct = order ? ((order - order * TAX_RATE - budget) / order) * 100 : 0;
    let accCost = 0;
    let lastPct = 0;
    let accBilling = 0;
    const rows = months.map((ym) => {
      const m = monthly.get(ym) ?? { labor: 0, transport: 0, entries: 0, billing: 0 };
      accCost += m.labor + m.transport + m.entries;
      accBilling += m.billing;
      const prev = lastPct;
      if (progMap.has(ym)) lastPct = progMap.get(ym)!;
      const revenue = (order * lastPct) / 100;
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
      return { label: r.label, ...pm, materiais: pm.materiais + pm.ferramentas };
    });
    const bi = ((work as any).budget_items ?? {}) as Record<string, number>;
    const items = ITEMS.map((it) => {
      const b = Number(bi[it.key] ?? 0);
      const r = real[it.key];
      return { key: it.key, label: it.label, budget: b, real: r, used: b ? (r / b) * 100 : r ? 100 : 0 };
    });
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
    return { rows, last, order, budget, budgetMarginPct, tot, items, monthBars, first, lastDay, days, laborRows, transportRows, vtRows, vtTotal, driverRows, driverTotal, travelRows, travelTotal, siblingCount: d.siblingCount };
  }, [work, data.data, untilMonth, isAll, holidaysQ.data]);

  // ---------- Edição ----------
  const [orderList, setOrderList] = useState<{ number: string; value: string }[]>([]);
  const ordersSum = orderList.reduce((a, o) => a + num(o.value), 0);
  const [quoteNo, setQuoteNo] = useState("");
  const [itemStrs, setItemStrs] = useState<Record<string, string>>({});
  const itemsSum = ITEMS.reduce((a, it) => a + num(itemStrs[it.key] ?? ""), 0);
  const [bdiOn, setBdiOn] = useState(false);
  /** Custos BDI: total orçado = pedido × 0,5885, dividido 4/2/1/3 (MO/transp./ferram./mat.).
   * Com custos realizados, os pesos ficam metade padrão e metade proporcional ao realizado.
   * Com andaime e sem ferramentas, o peso de ferramentas vai para andaimes. */
  const applyBdi = () => {
    const BDI = 0.5885;
    const order = Number((work as any)?.order_value ?? 0);
    const real = Object.fromEntries((calc?.items ?? []).map((i) => [i.key, i.real])) as Record<string, number>;
    const w: Record<string, number> = { mo: 4, transporte: 2, ferramentas: 1, materiais: 3, andaimes: 0 };
    if ((real["andaimes"] ?? 0) > 0 && !(real["ferramentas"] ?? 0)) { w["andaimes"] = w["ferramentas"]!; w["ferramentas"] = 0; }
    const realTotal = ITEMS.reduce((a, it) => a + (real[it.key] ?? 0), 0);
    if (realTotal > 0) for (const it of ITEMS) w[it.key] = 0.5 * w[it.key]! + 0.5 * (10 * (real[it.key] ?? 0)) / realTotal;
    const sumW = ITEMS.reduce((a, it) => a + w[it.key]!, 0) || 1;
    const total = order * BDI;
    setItemStrs(Object.fromEntries(ITEMS.map((it) => [it.key, ((total * w[it.key]!) / sumW).toFixed(2).replace(".", ",")])));
  };
  const [progMonth, setProgMonth] = useState(new Date().toISOString().slice(0, 7));
  const [progPct, setProgPct] = useState("");
  const [entry, setEntry] = useState({ date: new Date().toISOString().slice(0, 10), category: "materiais", description: "", amount: "" });
  const [dlg, setDlg] = useState<null | "cliente" | "orcamento" | "andamento" | "lancamentos" | "faturamentos">(null);
  const [detail, setDetail] = useState<ItemKey | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["work-result"] });
    qc.invalidateQueries({ queryKey: ["works-result"] });
  };

  const saveValues = useMutation({
    mutationFn: async () => {
      const list = orderList.filter((o) => o.number.trim() || num(o.value));
      const { error } = await supabase
        .from("works")
        .update({
          orders: list.map((o) => ({ number: o.number.trim(), value: num(o.value) })),
          order_value: ordersSum,
          order_number: list.map((o) => o.number.trim()).filter(Boolean).join(" / ") || null,
          quote_number: quoteNo.trim() || null,
          budget_cost: itemsSum,
          budget_items: Object.fromEntries(ITEMS.map((it) => [it.key, num(itemStrs[it.key] ?? "")])),
        } as any)
        .eq("id", workId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valores salvos");
      setDlg(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProgress = useMutation({
    mutationFn: async () => {
      const p = num(progPct);
      if (p < 0 || p > 100) throw new Error("Informe um percentual entre 0 e 100");
      const { error } = await supabase
        .from("work_progress")
        .upsert({ work_id: workId, month: `${progMonth}-01`, percent: p }, { onConflict: "work_id,month" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Andamento salvo");
      setProgPct("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delProgress = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_progress").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const saveEntry = useMutation({
    mutationFn: async () => {
      const amount = num(entry.amount);
      if (!amount) throw new Error("Informe o valor");
      if (editingId) {
        const { error } = await supabase.from("work_entries").update({
          entry_date: entry.date,
          category: entry.category,
          description: entry.description.trim() || null,
          amount,
        }).eq("id", editingId);
        if (error) throw error;
        return;
      }
      if (isAll) {
        // Rateio proporcional às horas trabalhadas em cada serviço
        const raw = data.data;
        if (!raw) throw new Error("Aguarde o carregamento dos dados");
        const hours = new Map<string, number>(workIds.map((id) => [id, 0]));
        const rdo = new Map<string, any>(raw.rdoWf.map((r: any) => [`${r.collaborator_id}|${r.report_date}|${r.work_id}`, r]));
        const seen = new Set<string>();
        for (const a of raw.allocs) {
          const dt = a.daily_schedules?.schedule_date;
          if (!dt) continue;
          const k = `${a.collaborator_id}|${dt}|${a.work_id}`;
          seen.add(k);
          const r = rdo.get(k);
          const h = r ? (r.present ? Number(r.worked_hours ?? DEFAULT_HOURS) : 0) : DEFAULT_HOURS;
          hours.set(a.work_id, (hours.get(a.work_id) ?? 0) + h);
        }
        for (const r of raw.rdoWf) {
          const k = `${r.collaborator_id}|${r.report_date}|${r.work_id}`;
          if (seen.has(k) || !r.present) continue;
          hours.set(r.work_id, (hours.get(r.work_id) ?? 0) + Number(r.worked_hours ?? 0));
        }
        const total = [...hours.values()].reduce((a, b) => a + b, 0);
        if (!total) throw new Error("Nenhuma hora trabalhada nos serviços para ratear");
        const parts = [...hours.entries()].filter(([, h]) => h > 0);
        let rest = Math.round(amount * 100);
        const rows = parts.map(([id, h], i) => {
          const cents = i === parts.length - 1 ? rest : Math.round((amount * 100 * h) / total);
          rest -= cents;
          const desc = entry.description.trim();
          return {
            work_id: id,
            entry_date: entry.date,
            category: entry.category,
            description: `${desc ? desc + " — " : ""}Rateio ${((h / total) * 100).toFixed(1).replace(".", ",")}% (${Math.round(h)}h)`,
            amount: cents / 100,
          };
        });
        const { error } = await supabase.from("work_entries").insert(rows);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("work_entries").insert({
        work_id: workId,
        entry_date: entry.date,
        category: entry.category,
        description: entry.description.trim() || null,
        amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Lançamento atualizado" : "Lançamento salvo");
      setEditingId(null);
      setEntry((e) => ({ ...e, description: "", amount: "" }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const selectWork = (id: string) => {
    setWorkId(id);
    const w = works.data?.find((x) => x.id === id) as any;
    const f = (v: unknown) => (Number(v ?? 0) ? Number(v).toFixed(2).replace(".", ",") : "");
    const ol = Array.isArray(w?.orders) ? (w.orders as any[]) : [];
    setOrderList(ol.length ? ol.map((o) => ({ number: String(o.number ?? ""), value: f(o.value) })) : [{ number: "", value: "" }]);
    setQuoteNo(w?.quote_number ?? "");
    const bi = (w?.budget_items ?? {}) as Record<string, number>;
    setItemStrs(Object.fromEntries(ITEMS.map((it) => [it.key, f(bi[it.key])])));
  };

  const last = calc?.last;
  const billed = last?.billing ?? 0;
  const order = calc?.order ?? 0;
  const budgetMargin = order - order * TAX_RATE - (calc?.budget ?? 0);
  const realMargin = (last?.revenue ?? 0) * (1 - TAX_RATE) - (last?.cost ?? 0);
  const totBudget = calc?.items.reduce((a, i) => a + i.budget, 0) ?? 0;
  const totReal = calc?.items.reduce((a, i) => a + i.real, 0) ?? 0;
  const barItems = (() => {
    const src = calc?.items ?? [];
    const out: { key: string; label: string; budget: number; real: number; used: number }[] = [];
    const mat = { key: "materiais", label: "Materiais", budget: 0, real: 0, used: 0 };
    for (const i of src) {
      if (i.key === "materiais" || i.key === "ferramentas") {
        mat.budget += i.budget;
        mat.real += i.real;
        if (!out.includes(mat)) out.push(mat);
      } else out.push({ ...i });
    }
    mat.used = mat.budget ? (mat.real / mat.budget) * 100 : mat.real ? 100 : 0;
    return out.filter((i) => i.budget || i.real);
  })();
  const open = (k: NonNullable<typeof dlg>) => canEdit && setDlg(k);
  const isBilling = dlg === "faturamentos";
  const openEntries = (k: "lancamentos" | "faturamentos") => {
    setEntry((e) => ({ ...e, category: k === "faturamentos" ? "faturamento" : "materiais" }));
    setEditingId(null);
    setDlg(k);
  };
  const clickable = canEdit ? "cursor-pointer rounded-md transition-colors hover:bg-muted/60" : "";
  const w = work as any;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {(() => {
          const keyOf = groupKey;
          const clientMap = new Map<string, string>();
          visibleWorks.forEach((x: any) => clientMap.set(keyOf(x), x.clients?.name ?? x.client ?? "Sem cliente"));
          const clientList = [...clientMap.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
          const current = visibleWorks.find((x) => x.id === workId);
          const ck0 = clientKey || (current ? keyOf(current) : "");
          const ck = clientMap.has(ck0) ? ck0 : "";
          const services = visibleWorks.filter((x) => keyOf(x) === ck);
          return (
            <>
              <div className="w-full max-w-xs">
                <Select
                  value={ck}
                  onValueChange={(v) => {
                    setClientKey(v);
                    const list = visibleWorks.filter((x) => keyOf(x) === v);
                    if (list.length === 1) selectWork(list[0]!.id);
                    else setWorkId(ALL);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientList.map(([k, n]) => (
                      <SelectItem key={k} value={k}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full max-w-xs">
                <Select value={workId} onValueChange={selectWork} disabled={!ck}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.length > 1 && <SelectItem value={ALL}>Todos os serviços (geral)</SelectItem>}
                    {services.map((x) => (
                      <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Período:</span>
                <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Mês inicial" title={hasPeriod ? (activeIds.isLoading ? "Buscando obras do período…" : `${visibleWorks.length} serviço(s) com programação no período`) : "Sem período: mostrando todas as obras"} />
                <span className="text-muted-foreground">até</span>
                <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Mês final" />
                {hasPeriod && (
                  <Button variant="ghost" size="sm" onClick={() => { setFromMonth(""); setToMonth(""); }}>Limpar</Button>
                )}
              </div>
              {ck && (
                <ServiceDaysCalendar
                  workIds={workId && workId !== ALL ? [workId] : services.map((x) => x.id)}
                  names={Object.fromEntries(services.map((x) => [x.id, x.name]))}
                  multi={!workId || workId === ALL}
                />
              )}
            </>
          );
        })()}
        {work && canWrite && (
          <>
            <Button variant="outline" onClick={() => openEntries("lancamentos")} title={isAll ? "Valor rateado entre os serviços pelas horas trabalhadas" : undefined}>
              Lançamentos
            </Button>
            {!isAll && (
              <Button variant="outline" onClick={() => openEntries("faturamentos")}>
                Faturamentos
              </Button>
            )}
          </>
        )}
      </div>

      {!work && <p className="text-sm text-muted-foreground">Selecione um serviço para ver o relatório financeiro.</p>}

      {work && (
        <div className="rounded-lg border bg-card px-8 py-6 shadow-sm">
          {/* Cabeçalho */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 border-b pb-4">
            <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-6 gap-y-1 text-sm justify-self-start">
              <span className="text-muted-foreground">Primeiro Dia:</span>
              <span className="font-semibold">{calc?.first ? fmtDate(calc.first) : "—"}</span>
              <span className="text-muted-foreground">Dias Totais</span>
              <span />
              <span className="text-muted-foreground">Último Dia:</span>
              <span className="font-semibold">{calc?.lastDay ? fmtDate(calc.lastDay) : "—"}</span>
              <span className="font-semibold">{calc?.days ?? 0}</span>
              <span />
            </div>
            <h1 className="text-center text-3xl font-bold italic tracking-wide">RELATÓRIO FINANCEIRO DE OBRAS</h1>
            <div className="flex items-center gap-4 justify-self-end">
              <img src={ab5Logo.url} alt="AB5" className="h-14 w-14 object-contain" />
              <div className="text-sm">
                <p className="text-muted-foreground">Atualização</p>
                <p className="font-semibold">{fmtDate(new Date().toISOString().slice(0, 10))}</p>
              </div>
            </div>
          </div>

          {/* Linha 1 */}
          <div className="grid gap-6 border-b py-5 xl:grid-cols-[1fr_2fr_1fr]">
            <div className={`p-3 ${clickable}`} onClick={() => open("cliente")} title={canEdit ? "Clique para editar" : undefined}>
              <SectionTitle>Dados do Cliente</SectionTitle>
              <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <Lbl>Cliente</Lbl>
                <span className="text-lg font-bold">{w.client ?? "—"}</span>
                <Lbl>Obra</Lbl>
                <span className="text-xs uppercase">{w.name}</span>
                <Lbl>Nº Pedido</Lbl>
                <span>{w.order_number || "—"}</span>
                <Lbl>Nº Orç. AB5</Lbl>
                <span>{w.quote_number || "—"}</span>
                <Lbl>Valor Faturado</Lbl>
                <span className="flex justify-between">
                  <span>{brl(billed)}</span>
                  <span>{order ? `${Math.round((billed / order) * 100)}%` : ""}</span>
                </span>
                <Lbl>Saldo a Faturar</Lbl>
                <span>{brl(order - billed)}</span>
              </div>
              <div className="mt-6 text-center">
                <SectionTitle>Valor do Pedido</SectionTitle>
                <p className="mt-2 text-xl font-bold">{brl(order)}</p>
              </div>
            </div>

            <div>
              <SectionTitle>Andamento Mensal</SectionTitle>
              <div className="mt-2 h-64">
                {calc && calc.monthBars.length > 0 ? (
                  <ResponsiveContainer>
                    <BarChart data={calc.monthBars} margin={{ left: 20 }}>
                      <CartesianGrid vertical={false} className="stroke-border" />
                      <XAxis dataKey="label" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={(v: number) => brl(v)} width={100} />
                      <Tooltip formatter={(v: number) => brl(v)} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="mo" name="R$ Total MO" fill="var(--primary)" />
                      <Bar dataKey="materiais" name="R$ Total Materiais" fill="var(--muted-foreground)" />
                      <Bar dataKey="transporte" name="R$ Total Transporte" fill="var(--foreground)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="pt-10 text-center text-sm text-muted-foreground">Sem custos lançados.</p>
                )}
              </div>
            </div>

            <div className={`p-3 ${clickable}`} onClick={() => open("andamento")} title={canEdit ? "Clique para lançar o andamento" : undefined}>
              <SectionTitle>Conclusão da Obra</SectionTitle>
              <Gauge value={last?.progress ?? 0} />
            </div>
          </div>

          {/* Linha 2 */}
          <div className="grid gap-6 pt-5 xl:grid-cols-[1fr_2fr_1fr]">
            <div className="h-64">
              {barItems.length ? (
                <ResponsiveContainer>
                  <BarChart data={barItems} layout="vertical" margin={{ right: 48 }} barGap={2}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={80} fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number) => brl(v)} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="real" name="Custo Realizado" fill="var(--primary)">
                      <LabelList dataKey="used" position="right" fontSize={11} className="fill-foreground" formatter={(v: number) => pct(Math.round(v))} />
                    </Bar>
                    <Bar dataKey="budget" name="Custo Orçado" fill="var(--chart-2)" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-10 text-center text-sm text-muted-foreground">Sem orçamento por item.</p>
              )}
            </div>

            <div className={`p-3 ${clickable}`} onClick={() => open("orcamento")} title={canEdit ? "Clique para editar o orçado" : undefined}>
              <SectionTitle>Custos Orçados x Realizado</SectionTitle>
              <table className="mx-auto mt-4 w-full max-w-2xl text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground italic">
                    <th className="py-1 text-left font-normal">Tipo de Custo</th>
                    <th className="text-right font-normal">Custo Orçado</th>
                    <th className="text-right font-normal">Custo Realizado</th>
                    <th className="text-right font-normal">% Utilizado</th>
                  </tr>
                </thead>
                <tbody>
                  {(calc?.items ?? []).map((i) => (
                    <tr key={i.key}>
                      <td className="py-1 pl-3">{i.label}</td>
                      <td className="text-right">{brl(i.budget)}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          title="Ver detalhes"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetail(i.key);
                          }}
                        >
                          {brl(i.real)}
                        </button>
                      </td>
                      <td className={`text-right ${i.used > 100 ? "text-destructive" : ""}`}>{Math.round(i.used)}%</td>
                    </tr>
                  ))}
                  <tr className="font-bold italic">
                    <td className="py-1">Total</td>
                    <td className="text-right">{brl(totBudget)}</td>
                    <td className="text-right">{brl(totReal)}</td>
                    <td className="text-right">{totBudget ? Math.round((totReal / totBudget) * 100) : 0}%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3">
              <SectionTitle>Margem de Contribuição</SectionTitle>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] text-center">
                <p className="border-b pb-1 text-sm italic text-muted-foreground">Orçado</p>
                <p className="border-b pb-1" />
                <p className="border-b pb-1 text-sm italic text-muted-foreground">Realizado</p>
                <p className="pt-6 text-sm">{brl(budgetMargin)}</p>
                <div className="row-span-2 mx-4 w-px bg-border" />
                <p className={`pt-6 text-sm ${realMargin < 0 ? "text-destructive" : ""}`}>{brl(realMargin)}</p>
                <p className="pt-4 text-lg">{pct(calc?.budgetMarginPct ?? 0)}</p>
                <p className={`pt-4 text-lg ${(last?.marginPct ?? 0) < 0 ? "text-destructive" : ""}`}>{pct(last?.marginPct ?? 0)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diálogos */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Custo realizado — {ITEMS.find((i) => i.key === detail)?.label}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto text-sm">
            {detail === "mo" && calc && (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  Horas do RDO (ausente = 0h; sem RDO, escalado = {DEFAULT_HOURS}h) × valor hora × adicional (sábado e hora extra acima de 8h × 1,6; domingo e feriado × 2) × {String(ENCARGOS).replace(".", ",")} (encargos; PJ sem encargos).
                </p>
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableCell>Colaborador</TableCell>
                      <TableCell className="text-right">Dias</TableCell>
                      <TableCell className="text-right">Horas</TableCell>
                      <TableCell className="text-right">Valor hora</TableCell>
                      <TableCell className="text-right">Custo</TableCell>
                    </TableRow>
                    {calc.laborRows.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="text-right">{l.days}</TableCell>
                        <TableCell className="text-right">{l.hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">{brl(l.rate)}</TableCell>
                        <TableCell className="text-right">{brl(l.cost)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={4}>Total calculado</TableCell>
                      <TableCell className="text-right">{brl(calc.tot.labor)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </>
            )}
            {detail === "transporte" && calc && (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  (KM ida × 2 × viagens × R$ {KM_RATE.toFixed(2).replace(".", ",")}) + (pedágio × 2 × viagens), rateado entre os {calc.siblingCount} serviço(s) do mesmo cliente proporcional aos colaboradores escalados no dia (sem ninguém escalado, divisão igual). Veículos com valor de KM próprio (ex.: Mercedes L1218 a R$ 5,00) escalados direto no serviço entram 100% neste serviço. Transporte de terceiros vem dos lançamentos.
                </p>
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableCell>Data</TableCell>
                      <TableCell className="text-right">KM ida</TableCell>
                      <TableCell className="text-right">Viagens</TableCell>
                      <TableCell className="text-right">KM</TableCell>
                      <TableCell className="text-right">Pedágio</TableCell>
                      <TableCell className="text-right">Custo dia</TableCell>
                      <TableCell className="text-right">Colab. (serviço/cliente)</TableCell>
                      <TableCell className="text-right">Rateado</TableCell>
                    </TableRow>
                    {calc.transportRows.map((t, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDate(t.date)}</TableCell>
                        <TableCell className="text-right">{t.km}</TableCell>
                        <TableCell className="text-right">{t.trips}</TableCell>
                        <TableCell className="text-right">{brl(t.kmCost)}</TableCell>
                        <TableCell className="text-right">{brl(t.toll)}</TableCell>
                        <TableCell className="text-right">{brl(t.kmCost + t.toll)}</TableCell>
                        <TableCell className="text-right">{t.direct ? "Direto" : t.total > 0 ? `${t.mine}/${t.total}` : "—"}</TableCell>
                        <TableCell className="text-right">{brl(t.share)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={7}>Total veículos</TableCell>
                      <TableCell className="text-right">{brl(calc.tot.transport - calc.vtTotal - calc.driverTotal - calc.travelTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="mb-2 mt-4 text-xs text-muted-foreground">
                  Vale Transporte dos colaboradores escalados neste serviço (regras de VT diárias/ida e volta; sem VT em falta, atestado, licença, abono etc.).
                </p>
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableCell>Data</TableCell>
                      <TableCell className="text-right">Colaboradores com VT</TableCell>
                      <TableCell className="text-right">Custo VT</TableCell>
                    </TableRow>
                    {calc.vtRows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>{fmtDate(r.date)}</TableCell>
                        <TableCell className="text-right">{r.people}</TableCell>
                        <TableCell className="text-right">{brl(r.cost)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>Total VT</TableCell>
                      <TableCell className="text-right">{brl(calc.vtTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="mb-2 mt-4 text-xs text-muted-foreground">
                  Prêmio Motorista dos carros com prêmio marcado no Transporte (faixas da aba Prêmio de Motorista), rateado como o veículo.
                </p>
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableCell>Data</TableCell>
                      <TableCell>Motorista</TableCell>
                      <TableCell>Veículo</TableCell>
                      <TableCell className="text-right">KM</TableCell>
                      <TableCell className="text-right">Prêmio</TableCell>
                      <TableCell className="text-right">Rateado</TableCell>
                    </TableRow>
                    {calc.driverRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDate(r.date)}</TableCell>
                        <TableCell>{r.driver}</TableCell>
                        <TableCell>{r.plate}</TableCell>
                        <TableCell className="text-right">{r.km}</TableCell>
                        <TableCell className="text-right">{brl(r.amount)}</TableCell>
                        <TableCell className="text-right">{brl(r.share)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={5}>Total Prêmio Motorista</TableCell>
                      <TableCell className="text-right">{brl(calc.driverTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="mb-2 mt-4 text-xs text-muted-foreground">
                  Prêmio Viagem dos colaboradores escalados neste serviço (distância da cidade do colaborador até a obra, faixas da aba Prêmio de Viagem).
                </p>
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableCell>Data</TableCell>
                      <TableCell className="text-right">Colaboradores com prêmio</TableCell>
                      <TableCell className="text-right">Custo</TableCell>
                    </TableRow>
                    {calc.travelRows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>{fmtDate(r.date)}</TableCell>
                        <TableCell className="text-right">{r.people}</TableCell>
                        <TableCell className="text-right">{brl(r.cost)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>Total Prêmio Viagem</TableCell>
                      <TableCell className="text-right">{brl(calc.travelTotal)}</TableCell>
                    </TableRow>
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>Total transporte (veículos + VT + prêmios)</TableCell>
                      <TableCell className="text-right">{brl(calc.tot.transport)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </>
            )}
            {detail && (
              <EntryList entries={(data.data?.entries ?? []).filter((e: any) => entryItem(e.category) === detail)} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "cliente"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados do cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Nº Orç. AB5" value={quoteNo} onChange={setQuoteNo} />
            <div className="flex items-center justify-between">
              <Label>Pedidos</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setOrderList((l) => [...l, { number: "", value: "" }])}>
                <Plus className="h-4 w-4" /> Adicionar pedido
              </Button>
            </div>
            {orderList.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Nº Pedido" value={o.number} onChange={(e) => setOrderList((l) => l.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                <Input className="w-40" placeholder="Valor (R$)" value={o.value} onChange={(e) => setOrderList((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remover" onClick={() => setOrderList((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              Valor do pedido (soma): <span className="font-semibold text-foreground">{brl(ordersSum)}</span>
            </p>
            <p className="text-xs text-muted-foreground">O valor faturado vem do botão Faturamentos.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "orcamento"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custos orçados</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {ITEMS.map((it) => (
              <Field
                key={it.key}
                label={`${it.label} (R$)`}
                value={itemStrs[it.key] ?? ""}
                onChange={(v) => setItemStrs((s) => ({ ...s, [it.key]: v }))}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={bdiOn} onCheckedChange={(v) => { setBdiOn(v); if (v) applyBdi(); }} />
            Custos BDI (pedido × 0,5885) — os valores podem ser ajustados depois
          </label>
          <p className="text-sm text-muted-foreground">
            Total orçado: <span className="font-semibold text-foreground">{brl(itemsSum)}</span>
          </p>
          <DialogFooter>
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "andamento"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Andamento da obra</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Mês</Label>
              <Input type="month" value={progMonth} onChange={(e) => setProgMonth(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>% acumulado</Label>
              <Input className="w-28" value={progPct} onChange={(e) => setProgPct(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProgress.mutate()} />
            </div>
            <Button onClick={() => saveProgress.mutate()} disabled={saveProgress.isPending} aria-label="Adicionar andamento">
              {editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
            {editingId && (
              <Button variant="ghost" size="icon" aria-label="Cancelar edição" onClick={() => { setEditingId(null); setEntry((x) => ({ ...x, description: "", amount: "" })); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Table>
            <TableBody>
              {(data.data?.progress ?? []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{monthLabel(String(p.month).slice(0, 7))}</TableCell>
                  <TableCell className="text-right">{pct(Number(p.percent))}</TableCell>
                  <TableCell className="w-10">
                    <Button variant="ghost" size="icon" onClick={() => delProgress.mutate(p.id)} aria-label="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "lancamentos" || dlg === "faturamentos"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{isBilling ? "Faturamentos" : "Lançamentos"}</DialogTitle>
          </DialogHeader>
          {isAll && !isBilling && (
            <p className="text-sm text-muted-foreground">O valor será rateado entre os serviços deste cliente, proporcional às horas trabalhadas em cada um.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" className="w-40" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
            <Select value={entry.category} onValueChange={(v) => setEntry({ ...entry, category: v })} disabled={isBilling}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.filter((c) => (c.key === "faturamento") === isBilling).map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="min-w-40 flex-1" placeholder="Descrição" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
            <Input className="w-32" placeholder="Valor" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEntry.mutate()} />
            <Button onClick={() => saveEntry.mutate()} disabled={saveEntry.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableBody>
                {(data.data?.entries ?? []).filter((e: any) => (e.category === "faturamento") === isBilling).map((e: any) => (
                  <TableRow key={e.id} className={editingId === e.id ? "bg-muted" : undefined}>
                    <TableCell>{fmtDate(e.entry_date)}</TableCell>
                    {isAll && <TableCell className="text-xs">{works.data?.find((x) => x.id === e.work_id)?.name ?? "—"}</TableCell>}
                    <TableCell>{catLabel(e.category)}</TableCell>
                    <TableCell>{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(Number(e.amount))}</TableCell>
                    <TableCell className="w-20 whitespace-nowrap">
                      <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => {
                        setEditingId(e.id);
                        setEntry({ date: e.entry_date, category: e.category, description: e.description ?? "", amount: Number(e.amount).toFixed(2).replace(".", ",") });
                      }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => delEntry.mutate(e.id)} aria-label="Excluir">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-sm font-semibold uppercase italic text-muted-foreground">{children}</p>;
}
function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold italic text-muted-foreground">{children}</span>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Velocímetro semicircular com faixas e ponteiro. */
function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const cx = 120, cy = 120, R = 100, r = 70;
  const pt = (p: number, rad: number) => {
    const a = Math.PI * (1 - p / 100);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const seg = (a: number, b: number) => {
    const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R), [x3, y3] = pt(b, r), [x4, y4] = pt(a, r);
    return `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 0 0 ${x4},${y4} Z`;
  };
  const bands = [0, 20, 40, 60, 80, 100];
  const [nx, ny] = pt(v, R - 4);
  const [bx1, by1] = pt(v + 50, 5);
  const [bx2, by2] = pt(v - 50, 5);
  return (
    <div className="mt-2 flex flex-col items-center">
      <svg viewBox="0 0 240 135" className="w-full max-w-xs">
        {bands.slice(0, -1).map((b, i) => (
          <path key={b} d={seg(b, bands[i + 1]!)} fill="var(--primary)" fillOpacity={0.15 + i * 0.2} />
        ))}
        <polygon points={`${nx},${ny} ${bx1},${by1} ${bx2},${by2}`} fill="var(--muted-foreground)" />
        <circle cx={cx} cy={cy} r={5} fill="var(--muted-foreground)" />
      </svg>
      <p className="text-2xl font-bold">{pct(v)}</p>
    </div>
  );
}

function EntryList({ entries }: { entries: any[] }) {
  if (!entries.length) return <p className="mt-4 text-xs text-muted-foreground">Nenhum lançamento manual para este item.</p>;
  const total = entries.reduce((a, e) => a + Number(e.amount), 0);
  return (
    <div className="mt-4">
      <p className="mb-1 font-semibold">Lançamentos</p>
      <Table>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{fmtDate(e.entry_date)}</TableCell>
              <TableCell>{catLabel(e.category)}</TableCell>
              <TableCell>{e.description ?? "—"}</TableCell>
              <TableCell className="text-right">{brl(Number(e.amount))}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell className="text-right">{brl(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

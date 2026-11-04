import { marginPercent, meanMarginPercent } from "@/lib/result-labor";
import { MarginPercent } from "@/components/margin-percent";
import { ResultSupport } from "@/components/result-support";
import { ResultRecurrences } from "@/components/result-recurrences";
import { contractFraction } from "@/lib/contract";
import { resultWorksForRole } from "@/lib/result-work-access";
import { isResultMonth } from "@/lib/result-period";
import { displayedBudgetItems } from "@/lib/result-budget";
import { filterPurchaseEntries } from "@/lib/purchase-policy";
import { loadWorkData, buildBase as engineBuildBase, fetchAll, totalMargin, TAX_RATE, KM_RATE, DEFAULT_HOURS, ITEMS, entryItem, monthLabel, monthEnd, bdiBudget, BDI_RATE, type ItemKey } from "@/lib/results-engine";
import { resplitClient, splitDesc } from "@/lib/resplit";
import { Switch } from "@/components/ui/switch";
import { useEffect, useMemo, useState } from "react";
import { workedHours, positionLabel } from "@/lib/rdo";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus, Pencil, Check, X, CalendarDays, Download, Repeat2 } from "lucide-react";
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
  component: () => <ResultadoPage />,
});

/** Multiplicador de encargos sobre o valor hora do colaborador. */
import { laborCost, ENCARGOS } from "@/lib/labor-cost";

const CATEGORIES = [
  { key: "mao_obra", label: "Mão de obra" },
  { key: "materiais", label: "Materiais" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "andaimes", label: "Andaimes" },
  { key: "terceiros", label: "Transporte de terceiros" },
  { key: "faturamento", label: "Faturamento" },
] as const;
// Cliente Indústria chama Andaimes de Insumos (só rótulo; cálculos iguais)
let INDUSTRIA_LABELS = false;
const isIndustria = (name?: string | null) => (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase() === "INDUSTRIA";
const relabel = (k: string, label: string) =>
  INDUSTRIA_LABELS && k === "andaimes" ? "Insumos" : label;
const catLabel = (k: string) => relabel(k, CATEGORIES.find((c) => c.key === k)?.label ?? k);


const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (s: string) => {
  const t = String(s).replace(/[^\d,.-]/g, "");
  // "1.234,56" → 1234.56 ; "12.5" (sem vírgula) → 12.5
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(n) || 0;
};
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");


export function ResultadoPage({ initialWorkId, initialMonths = [] }: { initialWorkId?: string; initialMonths?: string[] } = {}) {
  const { canWrite, role, user } = useCurrentUser();
  const qc = useQueryClient();
  const [workId, setWorkId] = useState<string>("");
  const [clientKey, setClientKey] = useState<string>("");
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() => [...initialMonths].sort());
  const [fromMonth, setFromMonth] = useState<string>(() => [...initialMonths].sort()[0] ?? "");
  const [toMonth, setToMonth] = useState<string>(() => [...initialMonths].sort().pop() ?? "");
  // Cálculos consideram tudo até o fim do período escolhido
  const untilMonth = toMonth;
  const hasPeriod = !!(fromMonth || toMonth);
  // Sem mês inicial: desde o começo da obra
  const periodStart = fromMonth ? `${fromMonth}-01` : "1900-01-01";
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
        fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id").eq("sync_cancelled", false).gte("entry_date", periodStart).lte("entry_date", periodEnd).order("id").range(a, b)),
      ]);
      rdoRows.forEach((r) => r.work_id && out.add(r.work_id));
      entryRows.forEach((r) => r.work_id && out.add(r.work_id));
      return out;
    },
  });

  const works = useQuery({
    queryKey: ["works-result", role, user?.id, "client-scope"],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("works").select("*, clients(name)").order("name");
      if (error) throw error;
      // Coordenadores herdam todos os serviços dos clientes atribuídos, inclusive novos.
      if (role === "coordenador" || role === "encarregado") {
        if (!user?.id) return [];
        const { data: mine, error: scopeError } = await supabase.from("foreman_works").select("work_id, works(client_id)").eq("user_id", user.id);
        if (scopeError) throw scopeError;
        return resultWorksForRole(data, role, mine ?? []);
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
  INDUSTRIA_LABELS = isIndustria((work as any)?.clients?.name ?? (work as any)?.client);
  const canEdit = canWrite && !isAll;

  const data = useQuery({
    queryKey: ["work-result", workId, workIds.join(","), "vt"],
    enabled: !!work,
    staleTime: 60_000,
    queryFn: async () => {
      return loadWorkData(work!, workIds, canWrite);
    },
  });

  const holidaysQ = useQuery({
    queryKey: ["holidays-dates"],
    queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string),
  });
  // ---------- Cálculos ----------
  const buildBase = (fromMonth: string, untilMonth: string) =>
    engineBuildBase(work, data.data, fromMonth, untilMonth, { isAll, workIds, holidays: (holidaysQ.data ?? []) as string[], allWorks: works.data ?? [], selectedMonths });
  const calcBase = useMemo(() => buildBase(fromMonth, untilMonth), [work, data.data, untilMonth, fromMonth, selectedMonths, isAll, holidaysQ.data, works.data]);
  // Margem realizada total da obra (sem filtro), para o card discreto
  const totalReal = useMemo(() => {
    const w: any = work;
    // Geral do cliente com serviços mensais: média simples da margem total dos serviços mensais que têm pedido
    if (isAll && data.data) {
      const svcs = (works.data ?? []).filter((x: any) => workIds.includes(x.id));
      const mensais = svcs.filter((x: any) => x.monthly_enabled && (Array.isArray(x.orders) ? x.orders : []).some((o: any) => o?.date));
      if (mensais.length) {
        const raw: any = data.data;
        const res = mensais.map((s: any) => {
          const sub = {
            ...raw,
            allocs: (raw.allocs ?? []).filter((a: any) => a.work_id === s.id),
            rdoWf: (raw.rdoWf ?? []).filter((r: any) => r.work_id === s.id),
            workTravelRows: (raw.workTravelRows ?? []).filter((r: any) => r.work_id === s.id),
            entries: (raw.entries ?? []).filter((e: any) => e.work_id === s.id),
            progress: (raw.progress ?? []).filter((p: any) => p.work_id === s.id),
          };
          const b = engineBuildBase(s, sub, "", untilMonth, { isAll: false, workIds: [s.id], holidays: (holidaysQ.data ?? []) as string[], allWorks: works.data ?? [] });
          return b?.last ? totalMargin(s, b) : null;
        }).filter(Boolean) as { margin: number; pct: number | null }[];
        if (res.length) return {
          margin: res.reduce((a, r) => a + r.margin, 0),
          pct: meanMarginPercent(res.map((r) => r.pct), res.reduce((a, r) => a + r.margin, 0)),
        };
      }
    }
    const mensal = !isAll && w?.monthly_enabled;
    if (!hasPeriod && !mensal) return null;
    const b = engineBuildBase(work, data.data, "", untilMonth, { isAll, workIds, holidays: (holidaysQ.data ?? []) as string[], allWorks: works.data ?? [] });
    if (!b?.last) return null;
    if (!isAll && w?.monthly_enabled) {
      return totalMargin(w, b);
    }
    const margin = b.last.revenue * (1 - TAX_RATE) - b.last.cost;
    return { margin, pct: marginPercent(margin, b.last.revenue) };
  }, [work, data.data, hasPeriod, isAll, holidaysQ.data, works.data, workIds, fromMonth, untilMonth, selectedMonths]);

  // ---------- Edição ----------
  const [orderList, setOrderList] = useState<{ number: string; value: string; date?: string }[]>([]);
  // HH: valor do pedido = horas dos RDOs × valor cobrado por hora da função
  const [hhOn, setHhOn] = useState(false);
  const [hhRates, setHhRates] = useState<Record<string, string>>({});
  const [hhDlg, setHhDlg] = useState(false);
  const [expDlg, setExpDlg] = useState(false);
  const [expSep, setExpSep] = useState<Record<string, boolean>>({});
  const hhRaw = useQuery({
    queryKey: ["hh-hours-raw", workId],
    enabled: !!workId && workId !== "__all__" && hhOn,
    queryFn: async () => {
      const [{ data: wf, error }, { data: pos }] = await Promise.all([
        supabase.from("rdo_workforce").select("report_date, collaborator_id, position_id, entry_time, exit_time, break_minutes, worked_hours, present, collaborators(position_id)").eq("work_id", workId).eq("present", true),
        supabase.from("positions").select("id, name").order("name"),
      ]);
      if (error) throw error;
      const rows = (wf ?? []).map((w) => ({
        date: w.report_date as string,
        cid: (w as any).collaborator_id as string,
        pid: (w.position_id ?? (w as any).collaborators?.position_id ?? "none") as string,
        h: w.worked_hours != null ? Number(w.worked_hours) : workedHours(w.entry_time, w.exit_time, w.break_minutes ?? 60),
      }));
      return { rows, names: new Map((pos ?? []).map((p) => [p.id, p.name])) };
    },
  });
  const aggHH = (from: string, to: string) => {
    if (!hhRaw.data || !Array.isArray(hhRaw.data.rows)) return undefined;
    const hours = new Map<string, number>();
    for (const r of hhRaw.data.rows) if (r.date >= from && r.date <= to) hours.set(r.pid, (hours.get(r.pid) ?? 0) + r.h);
    return [...hours.entries()]
      .map(([id, h]) => ({ id, name: id === "none" ? "Sem função" : hhRaw.data!.names.get(id) ?? "—", hours: h }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  };
  // Tabela de horas por função (serve ao diálogo de valores e ao relatório exportado)
  const hhData = { data: useMemo(() => aggHH("0000-01-01", "9999-12-31"), [hhRaw.data]), isLoading: hhRaw.isLoading };
  const hhValue = (hhData.data ?? []).reduce((a, r) => a + r.hours * num(hhRates[r.id] ?? ""), 0);
  const hhSavedWork = works.data?.find((x) => x.id === workId) as any;

  // HH: custo orçado de MO e transporte proporcional às horas/dias dos RDOs
  const hhRefs = useQuery({
    queryKey: ["hh-budget-refs-v2", hhSavedWork?.client_id ?? null],
    enabled: !!hhSavedWork?.hh_enabled,
    queryFn: async () => {
      const [pos, col, veh, dbr, cli] = await Promise.all([
        supabase.from("positions").select("id, name"),
        supabase.from("collaborators").select("position_id, salary").eq("status", "active"),
        supabase.from("vehicles").select("passenger_capacity, km_rate, status"),
        supabase.from("driver_bonus_rules").select("*").eq("active", true),
        hhSavedWork?.client_id
          ? supabase.from("clients").select("distance_km, has_toll, toll_amount").eq("id", hhSavedWork.client_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      return { pos: pos.data ?? [], col: col.data ?? [], veh: veh.data ?? [], dbr: dbr.data ?? [], cli: cli.data };
    },
  });
  const hhBudget = useMemo(() => {
    if (!hhSavedWork?.hh_enabled || !hhRaw.data || !Array.isArray(hhRaw.data.rows) || !hhRefs.data) return null;
    const { pos, col, veh, dbr, cli } = hhRefs.data;
    const base = (n: string) => positionLabel(n)?.toLowerCase() ?? n.toLowerCase();
    const level = (n: string) => Number(/n\s*\.?\s*([1-4])\s*$/i.exec(n)?.[1] ?? 0);
    const maxSal = new Map<string, number>();
    for (const c of col ?? []) if (c.position_id) maxSal.set(c.position_id, Math.max(maxSal.get(c.position_id) ?? 0, Number(c.salary ?? 0)));
    // Valor hora orçado = maior salário do nível mais alto (com salário) da mesma função
    const rateFor = new Map<string, number>();
    const posName = new Map((pos ?? []).map((p) => [p.id, p.name]));
    const rateOf = (pid: string) => {
      if (rateFor.has(pid)) return rateFor.get(pid)!;
      const n = posName.get(pid);
      let r = 0;
      if (n) {
        const fam = (pos ?? []).filter((p) => base(p.name) === base(n) && (maxSal.get(p.id) ?? 0) > 0);
        fam.sort((a, b) => level(b.name) - level(a.name) || (maxSal.get(b.id) ?? 0) - (maxSal.get(a.id) ?? 0));
        r = fam[0] ? maxSal.get(fam[0].id)! : maxSal.get(pid) ?? 0;
      }
      rateFor.set(pid, r);
      return r;
    };
    // Mesmo corte do realizado: até o fim do período e até o dia do último andamento apontado
    let cut = periodEnd;
    const lastProgDay = ((data.data?.progress ?? []) as any[])
      .map((p) => String(p.month).slice(0, 10))
      .filter((d) => !untilMonth || d <= monthEnd(untilMonth))
      .sort()
      .pop();
    if (lastProgDay && lastProgDay < cut) cut = lastProgDay;
    const rows = hhRaw.data.rows.filter((r) => r.date >= periodStart && r.date <= cut);
    const hol = new Set<string>((holidaysQ.data ?? []) as string[]);
    // MO orçada = horas × maior salário do topo da função cobrada no HH × 2,6 (encargos)
    const charged = (hhSavedWork.hh_rates ?? {}) as Record<string, number>;
    let mo = 0;
    const perDay = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!Number(charged[r.pid] ?? 0)) continue;
      mo += r.h * rateOf(r.pid) * ENCARGOS;
      if (!perDay.has(r.date)) perDay.set(r.date, new Set());
      perDay.get(r.date)!.add(r.cid);
    }
    void hol;
    const caps = (veh ?? []).filter((v) => v.status !== "inactive" && Number(v.passenger_capacity) > 0).map((v) => Number(v.passenger_capacity)).sort((a, b) => a - b);
    const cap = caps.length ? caps[Math.floor(caps.length / 2)]! : 7;
    const km = Number(cli?.distance_km ?? 0);
    const toll = cli?.has_toll ? Number(cli.toll_amount ?? 0) : 0;
    // ida e volta + pedágio + prêmio motorista (regras por distância)
    const bonus = ((dbr ?? []) as any[]).filter((r) => r.calculation_type !== "fixed_monthly" && km >= Number(r.minimum_distance ?? 0) && km <= (r.maximum_distance === null ? Infinity : Number(r.maximum_distance))).reduce((s, r) => s + Number(r.amount), 0);
    const carDay = km * 2 * 1.35 + toll * 2 + bonus;
    let transporte = 0;
    for (const n of perDay.values()) transporte += Math.ceil(n.size / cap) * carDay;
    return { mo, transporte };
  }, [hhSavedWork, hhRaw.data, hhRefs.data, periodStart, periodEnd, holidaysQ.data, data.data, untilMonth]);
  // HH segue o mesmo orçamento dos demais serviços (Custos BDI ou manual)
  void hhBudget;
  const calcHH = calcBase;
  /** Contrato: custo orçado e conclusão = faturamentos lançados ÷ meses do contrato. */
  const calcCt = useMemo(() => {
    const w = hhSavedWork;
    if (!calcHH || isAll || !w?.contract_enabled) return calcHH;
    const f = contractFraction(calcHH.billingCount, Number(w.contract_months ?? 12));
    const items = calcHH.items.map((i) => {
      const b = i.budget * f;
      return { ...i, budget: b, used: b ? (i.real / b) * 100 : i.real ? 100 : 0 };
    });
    const budget = items.reduce((a, i) => a + i.budget, 0);
    const order = calcHH.order;
    const last = calcHH.last ? { ...calcHH.last, progress: f * 100 } : calcHH.last;
    // Margem orçada do contrato: sempre pelo total (pedido cheio × custo orçado cheio), não acompanha a conclusão.
    const fullBudget = calcHH.items.reduce((a, i) => a + i.budget, 0);
    return { ...calcHH, items, budget, last, budgetMarginPct: order ? ((order - order * TAX_RATE - fullBudget) / order) * 100 : 0 };
  }, [calcHH, hhSavedWork, isAll]);
  const calcRt = calcCt;
  /** Mensal: pedido = soma dos pedidos com data no período (sem período = todos); orçado = % fixo do pedido. */
  const monthlyInfo = useMemo(() => {
    const w = hhSavedWork;
    if (!calcRt || isAll || !w?.monthly_enabled) return null;
    const list = (Array.isArray(w.orders) ? w.orders : []) as any[];
    const total = list.reduce((a, o) => a + Number(o.value ?? 0), 0);
    const order = hasPeriod
      ? list.filter((o) => o.date && isResultMonth(String(o.date).slice(0, 7), fromMonth, untilMonth, selectedMonths)).reduce((a, o) => a + Number(o.value ?? 0), 0)
      : total;
    return { order, f: total ? order / total : 0 };
  }, [calcRt, hhSavedWork, isAll, hasPeriod, periodStart, periodEnd, fromMonth, untilMonth, selectedMonths]);
  const calc = useMemo(() => {
    if (!calcRt || !monthlyInfo) return calcRt;
    // Mensal: custo orçado = pedidos do período × BDI (distribuído como em Custos BDI)
    const bb = bdiBudget(monthlyInfo.order, Object.fromEntries(calcRt.items.map((i) => [i.key, i.real])), { weights: (hhSavedWork as any)?.budget_items?.weights });
    const items = calcRt.items.map((i) => {
      const b = bb[i.key] ?? 0;
      return { ...i, budget: b, used: b ? (i.real / b) * 100 : i.real ? 100 : 0 };
    });
    const budget = items.reduce((a, i) => a + i.budget, 0);
    const order = monthlyInfo.order;
    // Mensal com período: receita = soma dos pedidos datados no período (até o mês da linha), sem avanço de andamento
    const list = (Array.isArray(hhSavedWork?.orders) ? hhSavedWork.orders : []) as any[];
    const rows = calcRt.rows.map((r) => {
      const revenue = list.filter((o) => o.date && isResultMonth(String(o.date).slice(0, 7), fromMonth, r.ym, selectedMonths)).reduce((a, o) => a + Number(o.value ?? 0), 0);
      const margin = revenue - revenue * TAX_RATE - r.cost;
      return { ...r, progress: 100, revenue, margin, marginPct: marginPercent(margin, revenue), consumed: budget ? (r.cost / budget) * 100 : 0 };
    });
    const last = rows.length ? { ...rows[rows.length - 1]!, progress: calcRt.last?.progress ?? rows[rows.length - 1]!.progress } : calcRt.last;
    return { ...calcRt, items, budget, order, rows, last, budgetMarginPct: order ? ((order - order * TAX_RATE - budget) / order) * 100 : 0 };
  }, [calcRt, monthlyInfo, hhSavedWork, hasPeriod, periodStart, fromMonth, selectedMonths]);
  const [ctOn, setCtOn] = useState(false);
  const [moOn, setMoOn] = useState(false);
  const [hhFrom, setHhFrom] = useState("");
  const [hhTo, setHhTo] = useState("");
  const [ctMonths, setCtMonths] = useState("12");
  const ordersSum = orderList.reduce((a, o) => a + num(o.value), 0);
  const [quoteNo, setQuoteNo] = useState("");
  const [itemStrs, setItemStrs] = useState<Record<string, string>>({});
  const [bdiOn, setBdiOn] = useState(false);
  const [weightStrs, setWeightStrs] = useState<Record<string, string>>({});
  const weightsObj = () => {
    const w = Object.fromEntries(ITEMS.map((it) => [it.key, num(weightStrs[it.key] ?? "")]));
    return Object.values(w).some((v) => v > 0) ? w : undefined;
  };
  const itemsSum = ITEMS.reduce((a, it) => a + num(itemStrs[it.key] ?? ""), 0);
  /** Custos BDI: preenche os campos agora; com o BDI ativo, o orçado é recalculado sozinho a cada pedido. */
  const applyBdi = () => {
    const order = ordersSum || Number((work as any)?.order_value ?? 0);
    if (!order) { toast.error("Informe o valor do pedido antes de usar Custos BDI"); return; }
    const real = Object.fromEntries((calc?.items ?? []).map((i) => [i.key, i.real]));
    setItemStrs((cur) => {
      const saved = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, num(v)]));
      const b = bdiBudget(order, real, { ...saved, weights: weightsObj() });
      return Object.fromEntries(ITEMS.map((it) => [it.key, Number(b[it.key] ?? 0).toFixed(2).replace(".", ",")]));
    });
  };
  // Com BDI ativo, os campos acompanham o valor dos pedidos enquanto edita
  useEffect(() => {
    if (bdiOn && ordersSum) applyBdi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bdiOn, ordersSum]);
  const [progDate, setProgDate] = useState(new Date().toISOString().slice(0, 10));
  const [progPct, setProgPct] = useState("");
  const [entry, setEntry] = useState({ date: new Date().toISOString().slice(0, 10), category: "materiais", description: "", amount: "", competence: "" });
  const [compOpen, setCompOpen] = useState(false);
  const [recurrenceSeed, setRecurrenceSeed] = useState<any>(null);
  // Serviços fora do rateio no resultado geral (por padrão todos participam)
  const [splitOff, setSplitOff] = useState<string[]>([]);
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
          orders: list.map((o) => ({ number: o.number.trim(), value: num(o.value), ...(moOn && o.date ? { date: o.date } : {}) })),
          order_value: ordersSum,
          hh_enabled: hhOn,
          contract_enabled: ctOn,
          rental_enabled: false,
          monthly_enabled: moOn,
          contract_months: Math.max(1, parseInt(ctMonths) || 12),
          hh_rates: Object.fromEntries(Object.entries(hhRates).map(([k, v]) => [k, num(v)]).filter(([, v]) => v)),
          order_number: list.map((o) => o.number.trim()).filter(Boolean).join(" / ") || null,
          quote_number: quoteNo.trim() || null,
          budget_cost: bdiOn ? Math.round(ordersSum * BDI_RATE * 100) / 100 : itemsSum,
          budget_items: { ...Object.fromEntries(ITEMS.map((it) => [it.key, num(itemStrs[it.key] ?? "")])), bdi: bdiOn ? 1 : 0, ...(weightsObj() ? { weights: weightsObj() } : {}) },
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
        .upsert({ work_id: workId, month: progDate, percent: p }, { onConflict: "work_id,month" });
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
      // Faturamento pode ser 0 (ex.: mês de contrato sem cobrança); demais lançamentos exigem valor
      if (String(entry.amount ?? "").trim() === "" || (!amount && entry.category !== "faturamento")) throw new Error("Informe o valor");
      if (editingId) {
        const { error } = await supabase.from("work_entries").update({
          entry_date: entry.date,
          category: entry.category,
          description: entry.description.trim() || null,
          amount,
          competence_month: entry.category === "faturamento" && entry.competence && entry.competence !== entry.date.slice(0, 7) ? entry.competence : null,
        } as any).eq("id", editingId);
        if (error) throw error;
        return;
      }
      if (isAll) {
        // Rateio proporcional às horas trabalhadas em cada serviço
        const raw = data.data;
        if (!raw) throw new Error("Aguarde o carregamento dos dados");
        const targets = workIds.filter((id) => !splitOff.includes(id));
        if (!targets.length) throw new Error("Selecione ao menos um serviço para o rateio");
        const hours = new Map<string, number>(targets.map((id) => [id, 0]));
        const rdo = new Map<string, any>(raw.rdoWf.map((r: any) => [`${r.collaborator_id}|${r.report_date}|${r.work_id}`, r]));
        const seen = new Set<string>();
        for (const a of raw.allocs) {
          const dt = a.daily_schedules?.schedule_date;
          if (!dt) continue;
          const k = `${a.collaborator_id}|${dt}|${a.work_id}`;
          seen.add(k);
          const r = rdo.get(k);
          const h = r ? (r.present ? Number(r.worked_hours ?? DEFAULT_HOURS) : 0) : DEFAULT_HOURS;
          if (hours.has(a.work_id)) hours.set(a.work_id, hours.get(a.work_id)! + h);
        }
        for (const r of raw.rdoWf) {
          const k = `${r.collaborator_id}|${r.report_date}|${r.work_id}`;
          if (seen.has(k) || !r.present || !hours.has(r.work_id)) continue;
          hours.set(r.work_id, (hours.get(r.work_id) ?? 0) + Number(r.worked_hours ?? 0));
        }
        const total = [...hours.values()].reduce((a, b) => a + b, 0);
        if (!total) throw new Error("Nenhuma hora trabalhada nos serviços para ratear");
        const parts = [...hours.entries()].filter(([, h]) => h > 0);
        let rest = Math.round(amount * 100);
        const gid = crypto.randomUUID();
        const desc = entry.description.trim();
        const rows = parts.map(([id, h], i) => {
          const cents = i === parts.length - 1 ? rest : Math.round((amount * 100 * h) / total);
          rest -= cents;
          return {
            work_id: id,
            entry_date: entry.date,
            category: entry.category,
            description: splitDesc(desc, (h / total) * 100, h),
            amount: cents / 100,
            split_group: gid,
            split_total: amount,
            split_note: desc || null,
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
        competence_month: entry.category === "faturamento" && entry.competence && entry.competence !== entry.date.slice(0, 7) ? entry.competence : null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Lançamento atualizado" : "Lançamento salvo");
      setEditingId(null);
      setEntry((e) => ({ ...e, description: "", amount: "", competence: "" }));
      setCompOpen(false);
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
    setOrderList(ol.length ? ol.map((o) => ({ number: String(o.number ?? ""), value: f(o.value), date: o.date ? String(o.date) : "" })) : [{ number: "", value: "" }]);
    setQuoteNo(w?.quote_number ?? "");
    setHhOn(!!w?.hh_enabled);
    setCtOn(!!w?.contract_enabled);
    setMoOn(!!w?.monthly_enabled);
    setCtMonths(String(w?.contract_months ?? 12));
    setHhRates(Object.fromEntries(Object.entries((w?.hh_rates ?? {}) as Record<string, number>).map(([k, v]) => [k, f(v)])));
    setHhFrom("");
    setHhTo("");
    const bi = (w?.budget_items ?? {}) as Record<string, number>;
    setBdiOn(Number(bi["bdi"] ?? 0) === 1);
    setItemStrs(Object.fromEntries(ITEMS.map((it) => [it.key, f(bi[it.key])])));
    const wt = ((bi as any).weights ?? {}) as Record<string, number>;
    setWeightStrs(Object.fromEntries(ITEMS.map((it) => [it.key, wt[it.key] != null ? String(wt[it.key]) : ""])));
  };

  useEffect(() => {
    if (!initialWorkId || workId || !works.data?.length) return;
    const w0 = works.data.find((x: any) => x.id === initialWorkId) as any;
    if (!w0) return;
    setClientKey(groupKey(w0));
    selectWork(initialWorkId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkId, works.data]);

  const last = calc?.last;
  const billed = last?.billing ?? 0;
  // Geral: serviços mensais somam os pedidos do período; os demais usam o valor do pedido
  const allOrder = (() => {
    if (!isAll) return null;
    const inP = (ym: string) => !hasPeriod || isResultMonth(ym, fromMonth, untilMonth, selectedMonths);
    const svcs = (works.data ?? []).filter((x: any) => workIds.includes(x.id));
    if (!svcs.some((s: any) => s.monthly_enabled)) return null;
    return svcs.reduce((a: number, s: any) => a + (s.monthly_enabled
      ? ((Array.isArray(s.orders) ? s.orders : []) as any[]).filter((o) => o?.date && inP(String(o.date).slice(0, 7))).reduce((b, o) => b + Number(o.value ?? 0), 0)
      : Number(s.order_value ?? 0)), 0);
  })();
  const order = monthlyInfo ? monthlyInfo.order : allOrder ?? calc?.order ?? 0;
  const shownOrder = order;

  const expRange = () => {
    const from = hhFrom || hhTo ? hhFrom || "0000-01-01" : periodStart;
    const to = hhFrom || hhTo ? hhTo || "9999-12-31" : periodEnd;
    return (hhRaw.data?.rows ?? []).filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  };
  const fnName = (pid: string) => (pid === "none" ? "Sem função" : hhRaw.data?.names.get(pid) ?? "—");
  const expFns = useMemo(() => {
    if (!expDlg) return [] as string[];
    return [...new Set(expRange().map((r) => r.pid))].sort((a, b) => fnName(a).localeCompare(fnName(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expDlg, hhRaw.data, hhFrom, hhTo, periodStart, periodEnd]);
  const openExport = () => {
    if (!hhRaw.data) { toast.error("Horas dos RDOs ainda carregando"); return; }
    if (!expRange().length) { toast.error("Nenhuma hora apontada nos dias selecionados"); return; }
    setExpDlg(true);
  };

  const exportHH = async () => {
    if (!hhRaw.data) return;
    const rates = (hhSavedWork?.hh_enabled ? hhSavedWork.hh_rates ?? {} : Object.fromEntries(Object.entries(hhRates).map(([k, v]) => [k, num(v)]))) as Record<string, number>;
    const rows = expRange();
    if (!rows.length) return;
    const ids = [...new Set(rows.map((r) => r.cid))];
    const { data: cols } = await supabase.from("collaborators").select("id, full_name, cpf").in("id", ids);
    const cm = new Map((cols ?? []).map((c) => [c.id, c]));
    const fmt = (d: string) => d.split("-").reverse().join("/");
    const XLSX = await import("xlsx");
    const CUR = '"R$" #,##0.00';
    const sheet = (list: typeof rows) => {
      const aoa: (string | number)[][] = [["Data", "Nome", "CPF", "Função", "Horas trabalhadas", "Valor hora da função", "Valor total do dia"]];
      let total = 0;
      for (const r of list) {
        const rate = Number(rates[r.pid] ?? 0);
        const v = Math.round(r.h * rate * 100) / 100;
        total += v;
        const c = cm.get(r.cid);
        aoa.push([fmt(r.date), c?.full_name ?? "—", c?.cpf ?? "", positionLabel(fnName(r.pid)) ?? fnName(r.pid), Math.round(r.h * 100) / 100, rate, v]);
      }
      aoa.push([]);
      aoa.push(["Total do fechamento no período", "", "", "", "", "", Math.round(total * 100) / 100]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      for (let i = 1; i < aoa.length; i++) for (const col of ["F", "G"]) {
        const cell = ws[`${col}${i + 1}`];
        if (cell && typeof cell.v === "number") cell.z = CUR;
      }
      ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      return ws;
    };
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    const sheetName = (n: string) => {
      let base = n.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Aba";
      let k = base, i = 2;
      while (used.has(k)) k = `${base.slice(0, 26)} ${i++}`;
      used.add(k);
      return k;
    };
    const main = rows.filter((r) => !expSep[r.pid]);
    if (main.length) XLSX.utils.book_append_sheet(wb, sheet(main), sheetName("HH"));
    for (const pid of [...new Set(rows.map((r) => r.pid))].filter((p) => expSep[p])) {
      XLSX.utils.book_append_sheet(wb, sheet(rows.filter((r) => r.pid === pid)), sheetName(positionLabel(fnName(pid)) ?? fnName(pid)));
    }
    const name = `HH - ${w?.client ?? ""} - ${w?.name ?? ""} - ${fmt(rows[0]!.date).replace(/\//g, "-")} a ${fmt(rows[rows.length - 1]!.date).replace(/\//g, "-")}.xlsx`.replace(/[\\/:*?"<>|]/g, "");
    XLSX.writeFile(wb, name);
    setExpDlg(false);
  };
  const budgetMargin = order - order * TAX_RATE - (calc?.budget ?? 0);
  const realMargin = (last?.revenue ?? 0) * (1 - TAX_RATE) - (last?.cost ?? 0);
  // Margens fixas (independentes do filtro de período)
  const fullOrder = monthlyInfo
    ? ((Array.isArray((work as any)?.orders) ? (work as any).orders : []) as any[]).reduce((a, o) => a + Number(o.value ?? 0), 0)
    : Number((work as any)?.order_value ?? 0) || order;
  // Geral do cliente com serviços mensais: orçado só dos serviços com pedido, com BDI (pedidos × (1 − imposto − BDI))
  const allMonthlyOrders = (() => {
    if (!isAll) return null;
    const inP = (ym: string) => isResultMonth(ym, fromMonth, untilMonth, selectedMonths);
    const svcs = (works.data ?? []).filter((x: any) => workIds.includes(x.id) && x.monthly_enabled);
    const tot = svcs.reduce((a: number, s: any) => a + ((Array.isArray(s.orders) ? s.orders : []) as any[]).filter((o) => o?.date && inP(String(o.date).slice(0, 7))).reduce((b, o) => b + Number(o.value ?? 0), 0), 0);
    return tot > 0 ? tot : null;
  })();
  const fixedBudgetPct = allMonthlyOrders != null ? (1 - TAX_RATE - BDI_RATE) * 100 : calc?.budgetMarginPct ?? 0;
  const fixedBudget = { margin: (allMonthlyOrders ?? fullOrder) * (fixedBudgetPct / 100), pct: fixedBudgetPct };
  const fixedReal = totalReal ?? { margin: realMargin, pct: last?.marginPct ?? null };
  const totReal = calc?.items.reduce((a, i) => a + i.real, 0) ?? 0;
  const progFrac = (() => {
    const ob = Number(calc?.order ?? 0);
    return ob ? Math.min(1, Math.max(0, Number(last?.revenue ?? 0) / ob)) : 1;
  })();
  const monthlyBudgetOrder = monthlyInfo?.order ?? allMonthlyOrders;
  const monthlyBudget = monthlyBudgetOrder != null
    ? bdiBudget(monthlyBudgetOrder, Object.fromEntries((calc?.items ?? []).map((i) => [i.key, i.real])), { weights: (hhSavedWork as any)?.budget_items?.weights })
    : undefined;
  const scaledItems = displayedBudgetItems(calc?.items ?? [], progFrac, monthlyBudget);
  const totBudget = scaledItems.reduce((sum, item) => sum + item.budget, 0);
  const barItems = (() => {
    const src = scaledItems;
    const out: { key: string; label: string; budget: number; real: number; used: number }[] = [];
    const mat = { key: "materiais", label: "Materiais", budget: 0, real: 0, used: 0 };
    for (const i of src) {
      const b = i.budget;
      if (i.key === "materiais" || i.key === "ferramentas" || i.key === "andaimes") {
        mat.budget += b;
        mat.real += i.real;
        if (!out.includes(mat)) out.push(mat);
      } else out.push({ ...i, budget: b, used: b ? (i.real / b) * 100 : i.real ? 100 : 0 });
    }
    mat.used = mat.budget ? (mat.real / mat.budget) * 100 : mat.real ? 100 : 0;
    return out.filter((i) => i.budget || i.real);
  })();
  const open = (k: NonNullable<typeof dlg>) => canEdit && setDlg(k);
  const isBilling = dlg === "faturamentos";
  const [entryFilters, setEntryFilters] = useState({ from: "", to: "", category: "", description: "" });
  const filteredEntries = filterPurchaseEntries((data.data?.entries ?? []).filter((e: any) => (e.category === "faturamento") === isBilling), entryFilters);
  const openEntries = (k: "lancamentos" | "faturamentos") => {
    setEntry((e) => ({ ...e, category: k === "faturamentos" ? "faturamento" : "materiais" }));
    setEditingId(null);
    setEntryFilters({ from: fromMonth ? `${fromMonth}-01` : "", to: toMonth ? monthEnd(toMonth) : "", category: "", description: "" });
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
                <input type="month" value={fromMonth} onChange={(e) => { setSelectedMonths([]); setFromMonth(e.target.value); }} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Mês inicial" title={hasPeriod ? (activeIds.isLoading ? "Buscando obras do período…" : `${visibleWorks.length} serviço(s) com programação no período`) : "Sem período: mostrando todas as obras"} />
                <span className="text-muted-foreground">até</span>
                <input type="month" value={toMonth} onChange={(e) => { setSelectedMonths([]); setToMonth(e.target.value); }} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Mês final" />
                {hasPeriod && (
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedMonths([]); setFromMonth(""); setToMonth(""); }}>Limpar</Button>
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
                <span>
                  {(() => {
                    const all = (Array.isArray(w.orders) ? w.orders : []) as any[];
                    const list = hasPeriod
                      ? all.filter((o) => o?.date && isResultMonth(String(o.date).slice(0, 7), fromMonth, untilMonth, selectedMonths))
                      : all;
                    const n = list.length;
                    if (n > 1) return `${n} pedidos`;
                    if (n === 1) return String(list[0]?.number ?? "—");
                    return hasPeriod && all.length ? "—" : w.order_number || "—";
                  })()}
                </span>
                <Lbl>Nº Orç. AB5</Lbl>
                <span>{w.quote_number || "—"}</span>
                <Lbl>Valor Faturado</Lbl>
                <span className="flex justify-between">
                  <span>{brl(billed)}</span>
                  <span>{shownOrder ? `${Math.round((billed / shownOrder) * 100)}%` : ""}</span>
                </span>
                <Lbl>Saldo a Faturar</Lbl>
                <span>{brl(shownOrder - billed)}</span>
              </div>
              <div className="mt-6 text-center">
                <SectionTitle>Valor do Pedido</SectionTitle>
                <p className="mt-2 text-xl font-bold">{brl(shownOrder)}</p>
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
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload;
                          const empty = !p.mo && !p.materiais && !p.transporte;
                          if (empty && !p.faturamento) return null;
                          return (
                            <div className="rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow">
                              <p className="mb-1 font-medium">{label}</p>
                              {empty ? (
                                <p>Faturamento: {brl(p.faturamento)}</p>
                              ) : (
                                payload.map((it: any) => (
                                  <p key={it.dataKey} style={{ color: it.color }}>
                                    {it.name}: {brl(Number(it.value ?? 0))}
                                  </p>
                                ))
                              )}
                            </div>
                          );
                        }}
                      />
                      <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
                      <Bar dataKey="mo" name="R$ Total MO" fill="var(--chart-blue)" />
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
              <Gauge value={monthlyInfo || (isAll && (() => { const g = (works.data ?? []).filter((x: any) => workIds.includes(x.id)); return g.length > 0 && g.every((x: any) => x.monthly_enabled); })()) ? 100 : last?.progress ?? 0} />
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
                    <Legend wrapperStyle={{ fontSize: 13 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
                    <Bar dataKey="real" name="Custo Realizado" fill="var(--chart-blue)">
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
                  {scaledItems.map((i) => (
                    <tr key={i.key}>
                      <td className="py-1 pl-3">{relabel(i.key, i.label)}</td>
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
                <p className="pt-6 text-sm">{brl(fixedBudget.margin)}</p>
                <div className="row-span-2 mx-4 w-px bg-border" />
                <p className={`pt-6 text-sm ${fixedReal.margin < 0 ? "text-destructive" : ""}`}>{brl(fixedReal.margin)}</p>
                <p className="pt-4 text-lg">{pct(fixedBudget.pct)}</p>
                <p className="pt-4 text-lg"><MarginPercent value={fixedReal.pct} margin={fixedReal.margin} /></p>
              </div>
              {monthlyInfo && hasPeriod && (
                <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <SectionTitle>Margem Mensal</SectionTitle>
                  <div className={`flex items-baseline justify-center gap-4 pt-2 ${realMargin < 0 ? "text-destructive" : ""}`}>
                    <span className="text-sm">{brl(realMargin)}</span>
                    <span className="text-lg"><MarginPercent value={last?.marginPct ?? null} margin={realMargin} /></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diálogos */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Custo realizado — {catLabel(detail ?? "")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto text-sm">
            {detail === "mo" && <ResultSupport clientId={work?.client_id ?? undefined} canWrite={canWrite} />}
            {detail === "mo" && !!calc?.missingRdo.length && <div className="my-3 border-l-2 border-destructive pl-3 text-destructive"><p className="font-semibold">Escalado sem RDO</p>{calc.missingRdo.map((r) => <p key={`${r.id}:${r.workId}:${r.date}`}>{r.name} · {fmtDate(r.date)} · 0h</p>)}</div>}
            {detail === "mo" && !!calc?.supportNoActivity.length && <p className="my-3 text-destructive">Apoio sem base de horas: mantido no serviço escalado em {calc.supportNoActivity.map((r) => fmtDate(r.date)).join(", ")}.</p>}
            {detail === "mo" && calc && (
              <>
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
                  (KM ida × 2 × viagens × R$ {KM_RATE.toFixed(2).replace(".", ",")}) + (pedágio × 2 × viagens), rateado entre os {calc.siblingCount} serviço(s) do mesmo cliente proporcional aos colaboradores escalados no dia (serviço sem efetivo no dia não recebe custo). Veículos com valor de KM próprio (ex.: Mercedes L1218 a R$ 5,00) escalados direto no serviço entram 100% neste serviço. Transporte de terceiros vem dos lançamentos.
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
              <EntryList entries={(data.data?.entries ?? []).filter((e: any) => entryItem(e.category) === detail && e.entry_date >= periodStart && e.entry_date <= periodEnd)} />
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
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch checked={hhOn} onCheckedChange={setHhOn} /> HH
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch checked={ctOn} onCheckedChange={setCtOn} /> Faturamento Parcial
                </label>
                {ctOn && (
                  <div className="flex items-center gap-1 text-sm">
                    <Input className="h-8 w-16" inputMode="numeric" value={ctMonths} onChange={(e) => setCtMonths(e.target.value.replace(/\D/g, ""))} aria-label="Meses do faturamento parcial" />
                    meses
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch checked={moOn} onCheckedChange={setMoOn} /> Mensal
                </label>
              </div>
              {hhOn && (
                <Button type="button" size="sm" variant="outline" onClick={() => setHhDlg(true)}>Valores</Button>
              )}
            </div>
            {hhOn && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                <div className="space-y-1">
                  <Label className="text-xs">Início</Label>
                  <Input type="date" className="h-8 w-40" value={hhFrom} onChange={(e) => setHhFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fim</Label>
                  <Input type="date" className="h-8 w-40" value={hhTo} onChange={(e) => setHhTo(e.target.value)} />
                </div>
                {(hhFrom || hhTo) && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setHhFrom(""); setHhTo(""); }}>Limpar</Button>
                )}
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={openExport}>
                  <Download className="h-4 w-4" /> Exportar Relatório
                </Button>
                <Dialog open={expDlg} onOpenChange={setExpDlg}>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Exportar relatório HH</DialogTitle></DialogHeader>
                    <p className="text-sm text-muted-foreground">Marque as funções que devem ir para uma aba separada. As demais ficam juntas na aba HH.</p>
                    <div className="max-h-80 space-y-2 overflow-auto">
                      {expFns.map((pid) => (
                        <label key={pid} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                          <span>{fnName(pid)}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            {expSep[pid] ? "Aba separada" : "Aba HH"}
                            <Switch checked={!!expSep[pid]} onCheckedChange={(v) => setExpSep((p) => ({ ...p, [pid]: v }))} />
                          </span>
                        </label>
                      ))}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setExpDlg(false)}>Cancelar</Button>
                      <Button onClick={() => void exportHH()}><Download className="h-4 w-4" /> Baixar</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <p className="w-full text-xs text-muted-foreground">Os dias filtram apenas o relatório HH exportado. O valor do pedido vem dos pedidos lançados acima.</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label>Pedidos</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setOrderList((l) => [...l, { number: "", value: "" }])}>
                <Plus className="h-4 w-4" /> Adicionar pedido
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {orderList.map((o, i) => {
              const inPer = !moOn || !hasPeriod || !o.date || isResultMonth(String(o.date).slice(0, 7), fromMonth, untilMonth, selectedMonths);
              if (!inPer) return null;
              return (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Nº Pedido" value={o.number} onChange={(e) => setOrderList((l) => l.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                {moOn && (
                  <Input className="w-40" type="date" aria-label="Data do pedido" value={o.date ?? ""} onChange={(e) => setOrderList((l) => l.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                )}
                <Input className="w-40" placeholder="Valor (R$)" value={o.value} onChange={(e) => setOrderList((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remover" onClick={() => setOrderList((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              );
            })}
            </div>
            <p className="text-sm text-muted-foreground">
              Valor do pedido (soma{moOn && hasPeriod ? " do período" : ""}):{" "}
              <span className="font-semibold text-foreground">
                {brl(moOn && hasPeriod
                  ? orderList.filter((o) => !o.date || isResultMonth(String(o.date).slice(0, 7), fromMonth, untilMonth, selectedMonths)).reduce((a, o) => a + num(o.value), 0)
                  : ordersSum)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">O valor faturado vem do botão Faturamentos.</p>
          </div>
          <Dialog open={hhDlg} onOpenChange={setHhDlg}>
            <DialogContent>
              <DialogHeader><DialogTitle>Valor cobrado por hora (HH)</DialogTitle></DialogHeader>
              {hhData.isLoading && <p className="text-sm text-muted-foreground">Carregando horas dos RDOs...</p>}
              {!hhData.isLoading && !(hhData.data ?? []).length && <p className="text-sm text-muted-foreground">Nenhuma hora apontada em RDO neste serviço.</p>}
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {(hhData.data ?? []).map((r) => (
                  <div key={r.id} className="grid grid-cols-[1fr_70px_110px_110px] items-center gap-2 text-sm">
                    <span>{r.name}</span>
                    <span className="text-right text-muted-foreground">{r.hours.toFixed(1).replace(".", ",")}h</span>
                    <Input placeholder="R$/h" value={hhRates[r.id] ?? ""} onChange={(e) => setHhRates((m) => ({ ...m, [r.id]: e.target.value }))} />
                    <span className="text-right">{brl(r.hours * num(hhRates[r.id] ?? ""))}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm">Total: <span className="font-semibold">{brl(hhValue)}</span></p>
              <DialogFooter><Button onClick={() => setHhDlg(false)}>OK</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <DialogFooter>
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "orcamento"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Custos orçados</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {ITEMS.map((it) => (
              <Field
                key={it.key}
                label={`${relabel(it.key, it.label)} (R$)`}
                value={itemStrs[it.key] ?? ""}
                onChange={(v) => setItemStrs((s) => ({ ...s, [it.key]: v }))}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={bdiOn} onCheckedChange={(v) => { setBdiOn(v); if (v) applyBdi(); }} />
            Custos BDI (pedido × 0,5885) — recalculado automaticamente a cada novo pedido
          </label>
          {bdiOn && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Pesos desta obra (%) — ponto de partida; 75% da divisão acompanha o gasto real. Vazio = padrão 40/20/10/30.</p>
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 md:grid-cols-5">
                {ITEMS.map((it) => (
                  <div key={it.key} className="min-w-0 space-y-1">
                    <Label className="block whitespace-nowrap text-xs leading-5">{relabel(it.key, it.label)} %</Label>
                    <Input aria-label={`${relabel(it.key, it.label)} %`} value={weightStrs[it.key] ?? ""} onChange={(e) => setWeightStrs((s) => ({ ...s, [it.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={applyBdi}>Recalcular com os pesos</Button>
            </div>
          )}
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
              <Label>Dia</Label>
              <Input type="date" value={progDate} onChange={(e) => setProgDate(e.target.value)} />
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
              {[...(data.data?.progress ?? [])].sort((a: any, b: any) => String(a.month).localeCompare(String(b.month))).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(`${String(p.month).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell>
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
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isBilling ? "Faturamentos" : "Lançamentos"}</DialogTitle>
          </DialogHeader>
          {!isBilling && <ResultRecurrences key={recurrenceSeed?.id ?? 'recurrences'} workIds={workIds} seed={recurrenceSeed} clearSeed={() => setRecurrenceSeed(null)} onChanged={invalidate} />}
          {isAll && !isBilling && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">O valor será rateado entre os serviços selecionados, proporcional às horas trabalhadas em cada um.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-border p-2">
                {workIds.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!splitOff.includes(id)}
                      onCheckedChange={(on) => setSplitOff((s) => (on ? s.filter((x) => x !== id) : [...s, id]))}
                    />
                    {works.data?.find((x) => x.id === id)?.name ?? "—"}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" className="w-40" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
            <Select value={entry.category} onValueChange={(v) => setEntry({ ...entry, category: v })} disabled={isBilling}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.filter((c) => (c.key === "faturamento") === isBilling).map((c) => (
                  <SelectItem key={c.key} value={c.key}>{relabel(c.key, c.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="min-w-40 flex-1" placeholder="Descrição" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
            <Input className="w-32" placeholder="Valor" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEntry.mutate()} />
            {isBilling && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${entry.competence && entry.competence !== entry.date.slice(0, 7) ? "text-primary" : "text-muted-foreground/60"}`}
                title="Mês de competência"
                aria-label="Mês de competência"
                onClick={() => setCompOpen((o) => !o)}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            )}
            <Button onClick={() => saveEntry.mutate()} disabled={saveEntry.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {isBilling && compOpen && (
            <div className="flex items-center gap-2 text-sm">
              <Label className="text-muted-foreground">Mês de competência</Label>
              <Input type="month" className="w-44" value={entry.competence || entry.date.slice(0, 7)} onChange={(e) => setEntry({ ...entry, competence: e.target.value })} />
              <span className="text-xs text-muted-foreground">Padrão: mês do lançamento</span>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="space-y-1"><Label htmlFor="entries-from">De</Label><Input id="entries-from" type="date" className="w-40" value={entryFilters.from} onChange={(e) => setEntryFilters({ ...entryFilters, from: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="entries-to">Até</Label><Input id="entries-to" type="date" className="w-40" value={entryFilters.to} onChange={(e) => setEntryFilters({ ...entryFilters, to: e.target.value })} /></div>
            {!isBilling && <div className="space-y-1"><Label>Tipo</Label><Select value={entryFilters.category || "all"} onValueChange={(category) => setEntryFilters({ ...entryFilters, category: category === "all" ? "" : category })}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem>{ITEMS.map((c) => <SelectItem key={c.key} value={c.key}>{relabel(c.key, c.label)}</SelectItem>)}</SelectContent></Select></div>}
            <div className="min-w-40 flex-1 space-y-1"><Label htmlFor="entries-search">Buscar descrição</Label><Input id="entries-search" value={entryFilters.description} onChange={(e) => setEntryFilters({ ...entryFilters, description: e.target.value })} /></div>
          </div>
          <p className="text-sm font-semibold">{filteredEntries.length} lançamentos · Total filtrado: {brl(filteredEntries.reduce((a: number, e: any) => a + Number(e.amount), 0))}</p>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableBody>
                {filteredEntries.map((e: any) => (
                  <TableRow key={e.id} className={editingId === e.id ? "bg-muted" : undefined}>
                    <TableCell>
                      {fmtDate(e.doc_date ?? e.entry_date)}
                      {e.doc_date && <span className="ml-2 text-xs text-muted-foreground">Comp. {monthLabel(e.competence_month)}</span>}
                    </TableCell>
                    {isAll && <TableCell className="text-xs">{works.data?.find((x) => x.id === e.work_id)?.name ?? "—"}</TableCell>}
                    <TableCell>{catLabel(e.category)}</TableCell>
                    <TableCell>{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(Number(e.amount))}</TableCell>
                    <TableCell className="w-20 whitespace-nowrap">
                      {!isBilling && !e.recurrence_id && !e.sync_note_id && !e.purchase_cc_id && !e.industry_order_id && !e.industry_invoice_id && !e.split_group && <Button variant="ghost" size="icon" title="Tornar recorrente" aria-label="Tornar recorrente" onClick={() => setRecurrenceSeed(e)}><Repeat2 className="size-4" /></Button>}
                      <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => {
                        setEditingId(e.id);
                        setCompOpen(!!e.doc_date);
                        setEntry({ date: e.doc_date ?? e.entry_date, category: e.category, description: e.description ?? "", amount: Number(e.amount).toFixed(2).replace(".", ","), competence: e.competence_month ?? "" });
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
          <path key={b} d={seg(b, bands[i + 1]!)} fill="var(--chart-blue)" fillOpacity={0.15 + i * 0.2} />
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

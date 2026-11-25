import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { MENU_GROUPS } from "@/lib/menu";
import { Big, Donut, HoverBars, LineArea, OverviewCard } from "@/components/overview/charts";
import { CountUp } from "@/components/count-up";
import { useDriverRanking } from "@/components/frota/ranking";
import { dayKm, dayToll, normalizePlate } from "@/lib/fleet-costs";
import { closestPlate, isoDay, maintenanceState, type MaintenanceState } from "@/lib/fleet-notes";
import { KIND_LABEL, timeSpan, type LogDemand } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResultCard, ResultChartSkeleton } from "@/components/result-dashboard-shell";
import { ForkliftTransfer, type TransferHandle } from "@/components/frota/forklift-transfer";
import { useDashboardBudget } from "@/components/frota/use-dashboard-budget";
import { fleetDashboardCosts } from "@/lib/fleet-dashboard-costs";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";

export const Route = createFileRoute("/_authenticated/frota/")({
  pendingComponent: DashboardSkeleton,
  head: () => ({ meta: [{ title: "Veículos | AB5 Hub" }, { name: "description", content: "Visão geral da frota: manutenções, km, custos, ranking dos motoristas e logística." }, { property: "og:title", content: "Veículos | AB5 Hub" }, { property: "og:description", content: "Visão geral da frota: manutenções, km, custos, ranking dos motoristas e logística." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: FleetOverview,
});

const STATIC = 5 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (iso: string, n: number) => isoOf(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000));
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WD = ["S", "T", "Q", "Q", "S", "S", "D"];

type Period = "hoje" | "amanha" | "semana" | "mes";
const PERIODS: { key: Period; label: string }[] = [
  { key: "hoje", label: "Hoje" }, { key: "amanha", label: "Amanhã" }, { key: "semana", label: "Esta semana" }, { key: "mes", label: "Este mês" },
];
function rangeOf(p: Period, today: string) {
  if (p === "hoje") return { from: today, to: today };
  if (p === "amanha") { const t = addDays(today, 1); return { from: t, to: t }; }
  if (p === "semana") { const m = monday(today); return { from: m, to: addDays(m, 6) }; }
  const ym = today.slice(0, 7);
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

/** Visão geral do módulo Veículos (antiga Visão Geral de custos virou quadros daqui). */
function FleetOverview() {
  const { canAccess, loading } = useAccess();
  const nav = useNavigate();
  const items = MENU_GROUPS.find((g) => g.overview === "/frota")?.items ?? [];
  const allowed = items.some((i) => canAccess(i.url));
  useEffect(() => { if (!loading && !allowed) nav({ to: "/dashboard", replace: true }); }, [loading, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <DashboardSkeleton />;
  if (!allowed) return null;
  return <Overview canCost={canAccess("/frota/custos")} />;
}

type Vehicle = { id: string; plate: string; model: string | null; status: string | null; ownership: string | null; monthly_rent: number | null };
type Suggestion = { vehicleId: string; plate: string; due: string; week: string; reason: string; overdue: boolean };

function Overview({ canCost }: { canCost: boolean }) {
  const today = todayIso();
  const [selectedDay, setSelectedDay] = useState(today);
  const [deliveredDay, setDeliveredDay] = useState(today);
  const [timelineAbove, setTimelineAbove] = useState(false);
  const transfer = useRef<TransferHandle>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<Period>("hoje");
  const R = rangeOf(period, today);
  const single = R.from === R.to;
  // Calendário: o mês do início do período (semanas inteiras, seg–dom).
  const ym = R.from.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const calFrom = monday(`${ym}-01`), calTo = addDays(monday(`${ym}-${pad(lastDay)}`), 6);
  // Barras de km: dias do período (um dia só → o mês, para ter contexto).
  const barFrom = single ? `${ym}-01` : R.from, barTo = single ? `${ym}-${pad(lastDay)}` : R.to;
  const budgetFrom = `${ym}-01`, budgetTo = `${R.to.slice(0, 7)}-${pad(new Date(Date.UTC(Number(R.to.slice(0, 4)), Number(R.to.slice(5, 7)), 0)).getUTCDate())}`;
  const budget = useDashboardBudget(budgetFrom, budgetTo, canCost);
  const qFrom = [R.from, calFrom, barFrom, budgetFrom].sort()[0]!, qTo = [R.to, calTo, barTo, budgetTo].sort().at(-1)!;

  const vehiclesQ = useQuery({
    queryKey: ["overview", "fleet-vehicles"], staleTime: STATIC,
    queryFn: async () => ((await supabase.from("vehicles").select("id, plate, model, status, ownership, monthly_rent").order("plate")).data ?? []) as Vehicle[],
  });
  const schedQ = useQuery({
    queryKey: ["overview", "fleet-sched", qFrom, qTo], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: () => fetchAll<any>((a, b) => supabase.from("vehicle_schedules")
      .select("vehicle_id, schedule_date, km, trips, extra_km, is_suzano_local, is_maintenance, maintenance_kind, place_toll, clients(has_toll, toll_amount)")
      .gte("schedule_date", qFrom).lte("schedule_date", qTo).order("id").range(a, b)),
  });
  const expQ = useQuery({
    queryKey: ["overview", "fleet-exp", R.from, R.to], staleTime: 60_000, placeholderData: keepPreviousData, enabled: canCost,
    queryFn: () => fetchAll<any>((a, b) => supabase.from("fleet_expenses").select("source, plate, expense_date, amount")
      .gte("expense_date", R.from).lte("expense_date", R.to).order("id").range(a, b)),
  });
  const maintQ = useQuery({
    queryKey: ["overview", "fleet-maint"], staleTime: STATIC,
    queryFn: async () => {
      const [plans, recs, readings] = await Promise.all([
        supabase.from("vehicle_maintenance_plans").select("*").then((r) => r.data ?? []),
        fetchAll<any>((a, b) => supabase.from("vehicle_maintenance_records").select("vehicle_id, kind, km, service_date").order("service_date", { ascending: false }).range(a, b)),
        fetchAll<any>((a, b) => supabase.from("fleet_fuel_notes").select("plate, plate_fix, km, km_fix, issued_at")
          .gte("issued_at", new Date(Date.now() - 120 * 86_400_000).toISOString()).order("issued_at", { ascending: false }).range(a, b)),
      ]);
      return { plans, recs, readings };
    },
  });
  const logQ = useQuery({
    queryKey: ["overview", "fleet-log", calFrom, calTo], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => {
      const data = await fetchAll<LogDemand>((a, b) => supabase.from("log_demands").select("*").gte("scheduled_date", calFrom).lte("scheduled_date", calTo).order("id").range(a, b));
      const list = ((data ?? []) as LogDemand[]).filter((d) => !/cancel/i.test(String((d as any).status ?? "")));
      const addrIds = [...new Set(list.flatMap((d) => [(d as any).origin_id, (d as any).dest_id]).filter(Boolean))] as string[];
      const addrs = addrIds.length ? (await supabase.from("log_addresses").select("id, name, city").in("id", addrIds)).data ?? [] : [];
      return { list, addr: new Map(addrs.map((a) => [a.id, a.name])) };
    },
  });
  const rank = useDriverRanking({ from: R.from, to: R.to });

  const d = useMemo(() => {
    if (!vehiclesQ.data || !schedQ.data || !maintQ.data) return null;
    const vehicles = vehiclesQ.data.filter((v) => v.status !== "inactive");
    const vById = new Map(vehiclesQ.data.map((v) => [v.id, v]));
    const inR = (dt: string) => dt >= R.from && dt <= R.to;
    // Km por dia (barras) e do período.
    const kmBy = new Map<string, number>();
    const ranIn = new Set<string>();
    let toll = 0;
    for (const s of schedQ.data) {
      if (s.is_maintenance) continue;
      const k = dayKm(s);
      kmBy.set(s.schedule_date, (kmBy.get(s.schedule_date) ?? 0) + k);
      if (inR(s.schedule_date)) { ranIn.add(s.vehicle_id); toll += dayToll(s); }
    }
    const series = daysBetween(barFrom, barTo).map((x) => ({ label: brDay(x), value: Math.round(kmBy.get(x) ?? 0), tip: `${brDay(x)}: ${Math.round(kmBy.get(x) ?? 0).toLocaleString("pt-BR")} km` }));
    const km = daysBetween(R.from, R.to).reduce((a, x) => a + (kmBy.get(x) ?? 0), 0);
    // Custo real no período: combustível + manutenção (planilhas) + pedágio + locação proporcional aos dias.
    let fuel = 0, maint = 0;
    for (const x of expQ.data ?? []) (x.source === "combustivel" ? (fuel += Number(x.amount)) : (maint += Number(x.amount)));
    const nDays = daysBetween(R.from, R.to).length;
    const monthDays = lastDay;
    const rent = vehicles.filter((v) => v.ownership === "alugado").reduce((a, v) => a + Number(v.monthly_rent ?? 0), 0) * (nDays / monthDays);
    const cost = { fuel, maint, toll, rent, total: fuel + maint + toll + rent };
    // Situação da manutenção e sugestão da semana para marcar a revisão (pelo km médio por dia das notas do posto).
    const plates = vehiclesQ.data.map((v) => v.plate);
    const reads = new Map<string, { km: number; day: string }[]>();
    for (const r of maintQ.data.readings) {
      const p = r.plate_fix ? normalizePlate(r.plate_fix) : closestPlate(r.plate, plates);
      const k = r.km_fix ?? r.km;
      const day = isoDay(r.issued_at);
      if (!p || k == null || !day) continue;
      const list = reads.get(p) ?? [];
      list.push({ km: Number(k), day });
      reads.set(p, list);
    }
    const states: { v: Vehicle; state: MaintenanceState }[] = [];
    const suggestions: Suggestion[] = [];
    for (const v of vehicles) {
      const plan = (maintQ.data.plans as any[]).find((p) => p.vehicle_id === v.id) ?? null;
      const prev = (maintQ.data.recs as any[]).find((r) => r.vehicle_id === v.id && r.kind === "preventiva");
      const rs = reads.get(normalizePlate(v.plate)) ?? [];
      const cur = rs[0] ?? null;
      const state = maintenanceState(plan, prev ? { km: prev.km, date: prev.service_date } : null, cur?.km ?? null, today);
      states.push({ v, state });
      if (state.status === "sem-regra") continue;
      // km médio por dia entre a leitura mais nova e a mais antiga (até 120 dias).
      const old = rs[rs.length - 1];
      const spanDays = cur && old ? Math.max(1, (Date.parse(cur.day) - Date.parse(old.day)) / 86_400_000) : 0;
      const perDay = cur && old && spanDays >= 7 ? Math.max(0, (cur.km - old.km) / spanDays) : 0;
      const byKm = state.kmLeft != null && perDay > 0 ? addDays(today, Math.max(0, Math.floor(state.kmLeft / perDay))) : null;
      const due = state.status === "vencida" ? today : [byKm, state.nextDate].filter(Boolean).sort()[0] as string | undefined;
      if (!due) continue;
      // Sugere marcar na semana anterior ao vencimento (nunca antes desta semana).
      const week = [monday(addDays(due, -7)), monday(today)].sort().at(-1)!;
      const reason = state.status === "vencida" ? "revisão vencida"
        : state.kmLeft != null && byKm === due ? `faltam ${state.kmLeft.toLocaleString("pt-BR")} km` : `vence em ${brDay(due)}`;
      suggestions.push({ vehicleId: v.id, plate: v.plate, due, week, reason, overdue: state.status === "vencida" });
    }
    const counts = { vencida: 0, perto: 0, "em-dia": 0, "sem-regra": 0 } as Record<MaintenanceState["status"], number>;
    for (const s of states) counts[s.state.status]++;
    // Manutenções/revisões programadas na Transporte (calendário).
    const maintDays = new Map<string, { plate: string; kind: "man" | "rev" }[]>();
    for (const s of schedQ.data) {
      if (!s.is_maintenance) continue;
      const list = maintDays.get(s.schedule_date) ?? [];
      list.push({ plate: vById.get(s.vehicle_id)?.plate ?? "—", kind: s.maintenance_kind === "revisao" ? "rev" : "man" });
      maintDays.set(s.schedule_date, list);
    }
    const maintInRange = [...maintDays.entries()].filter(([dt]) => inR(dt)).reduce((a, [, l]) => a + l.length, 0);
    return { series, km, ran: ranIn.size, fleet: vehicles.length, cost, counts, suggestions, maintDays, maintInRange };
  }, [vehiclesQ.data, schedQ.data, expQ.data, maintQ.data, R.from, R.to, barFrom, barTo, today, lastDay]);

  const comparison = useMemo(() => fleetDashboardCosts((vehiclesQ.data ?? []).filter((v) => v.status !== "inactive"), schedQ.data ?? [], expQ.data ?? [], budget.data ?? new Map(), daysBetween(R.from, R.to), single), [vehiclesQ.data, schedQ.data, expQ.data, budget.data, R.from, R.to, single]);
  useEffect(() => { setSelectedDay(R.from); setDeliveredDay(R.from); }, [R.from]);
  const selectCalendarDay = (dt: string, element: HTMLElement, upper: boolean) => {
    if (dt === selectedDay) return;
    setSelectedDay(dt);
    const timeline = timelineRef.current, chart = chartRef.current;
    const swap = () => setTimelineAbove(upper);
    const delivered = () => setDeliveredDay(dt);
    if (timeline && chart && transfer.current) transfer.current.move(element, timeline, chart, swap, delivered, Number(dt.slice(8, 10)));
    else { swap(); delivered(); }
  };
  const pLabel = period === "hoje" ? "hoje" : period === "amanha" ? "amanhã" : period === "semana" ? "esta semana" : "este mês";
  const when = single ? brDay(R.from) : `${brDay(R.from)} a ${brDay(R.to)}`;
  const loadingNew = schedQ.isPlaceholderData || logQ.isPlaceholderData;
  return (
    <div className={cn("flex flex-col gap-3 transition-opacity duration-300 xl:h-[calc(100dvh-6.5rem)] xl:min-h-[640px]", loadingNew && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">Veículos</h1>
          <p className="hidden text-xs text-muted-foreground md:block">{when}. Clique em um quadro para abrir a página.</p>
        </div>
        <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
              className={cn("rounded-full px-3 py-1 transition-colors duration-300", period === p.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {!d ? (
        <DashboardSkeleton />
      ) : (
        <div className="fleet-dashboard-layout flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-2">
            <div className="min-h-0">
          <ResultCard dark title={`Manutenções e revisões — ${MONTHS[Number(ym.slice(5, 7)) - 1]}`}
            className="h-full min-h-[28rem] xl:min-h-0">
            <MaintCalendar ym={ym} calFrom={calFrom} calTo={calTo} range={R} today={today} maintDays={d.maintDays} suggestions={d.suggestions} selected={selectedDay} onSelect={selectCalendarDay} />
          </ResultCard>


            </div>
            <div className="fleet-dashboard-stack flex min-h-0 flex-col gap-3 xl:grid xl:grid-rows-2">
              <div ref={chartRef} className={cn("min-h-0 min-w-0", timelineAbove ? "order-2" : "order-1")}>
                <ResultCard title={single ? `Orçado × gasto por veículo — ${when}` : `Orçado × gasto por dia — ${when}`} className="h-full min-h-64">
                  {canCost ? budget.error || expQ.error ? <p className="text-sm text-muted-foreground">Não foi possível carregar os custos.</p> : !budget.data || expQ.isPending ? <ResultChartSkeleton /> : (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Orçado <CountUp value={brl(comparison.reduce((sum, x) => sum + x.a, 0))} /></span><span>Gasto <CountUp value={brl(comparison.reduce((sum, x) => sum + x.b, 0))} /></span></div>
                      <div className="mb-2 flex gap-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-foreground" />Orçado</span><span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-muted-foreground" />Gasto</span></div>
                      <LineArea className="min-h-0 flex-1" height="h-36 xl:h-auto xl:min-h-0 xl:flex-1" data={comparison} format={(x) => `Orçado ${brl(x.a)} · Gasto ${brl(x.b ?? 0)}`} />
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Custos disponíveis para quem tem acesso à Visão Geral.</p>}
                </ResultCard>
              </div>
              <div ref={timelineRef} className={cn("min-h-0 min-w-0", timelineAbove ? "order-1" : "order-2")}>
                <ResultCard title={`Logística — ${brDay(deliveredDay)}`} className="h-full min-h-64">
                  {logQ.isPending ? <ResultChartSkeleton /> : <LogTimeline key={deliveredDay} list={(logQ.data?.list ?? []).filter((x) => x.scheduled_date === deliveredDay)} addr={logQ.data?.addr ?? new Map()} vehicles={new Map((vehiclesQ.data ?? []).map((v) => [v.id, v.plate]))} single />}
                </ResultCard>
              </div>
            </div>
          </div>
          <div className="grid shrink-0 gap-3 md:grid-cols-2 xl:h-[13.25rem] xl:grid-cols-4">

          <OverviewCard dark title={`Km rodados — ${pLabel}`} to="/veiculos/transporte" linkLabel="Abrir Transporte" hint="Km da escala da Transporte (ida e volta × viagens + obras adicionais)" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <Big dark value={Math.round(d.km).toLocaleString("pt-BR")} />
            <p className="text-xs text-background/60">{d.ran} de {d.fleet} veículos rodaram{single ? ` · barras do mês` : ""}</p>
            <div className="mt-auto pt-2"><HoverBars dark data={d.series} format={(v) => `${v.toLocaleString("pt-BR")} km`} height="h-16" /></div>
          </OverviewCard>

          {canCost ? (
            <OverviewCard title={`Custo da frota — ${pLabel}`} to="/frota/custos" linkLabel="Ver custos detalhados" hint="Combustível (planilha do posto) + manutenção (planilha do Romildo) + pedágio + locação proporcional aos dias" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
              <Big value={brl(d.cost.total)} />
              <p className="text-xs text-muted-foreground">{d.km ? `${(d.cost.total / d.km).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por km` : "sem km no período"}</p>
              <div className="mt-auto">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  {COST_PARTS.map((p, i) => <span key={p.key} className={cn("ov-grow h-full", TONES[i])} style={{ width: `${(d.cost[p.key] / Math.max(1, d.cost.total)) * 100}%` }} />)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {COST_PARTS.map((p, i) => (
                    <span key={p.key} className="flex items-center gap-1.5 truncate"><span className={cn("h-2 w-2 shrink-0 rounded-sm", TONES[i])} />{p.label} <b className="tabular-nums">{brl(d.cost[p.key])}</b></span>
                  ))}
                </div>
              </div>
            </OverviewCard>
          ) : (
            <OverviewCard title={`Manutenções na escala — ${pLabel}`} to="/veiculos/transporte" linkLabel="Abrir Transporte" hint="Dias de manutenção/revisão lançados na Transporte" className="min-h-0">
              <Big value={d.maintInRange} />
              <p className="text-xs text-muted-foreground">dias de veículo em manutenção ou revisão</p>
            </OverviewCard>
          )}

          <OverviewCard title="Manutenção preventiva" to="/frota/manutencao" linkLabel="Abrir Manutenção" hint="Situação de cada veículo pela regra de revisão (km e/ou meses) e o km da última nota do posto" className="min-h-0">
            {(() => {
              const withRule = d.fleet - d.counts["sem-regra"];
              return (
                <div className="grid grid-cols-2 items-center gap-3">
                  <div className="min-w-0 space-y-1 text-[11px]">
                    <Big value={d.counts.vencida + d.counts.perto} />
                    <p className="text-xs text-muted-foreground">vencidas ou perto</p>
                    {([["vencida", "Vencidas"], ["perto", "Perto"], ["em-dia", "Em dia"], ["sem-regra", "Sem regra"]] as const).map(([k, l], i) => (
                      <div key={k} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", TONES[i])} /><span className="flex-1">{l}</span><b className="tabular-nums">{d.counts[k]}</b></div>
                    ))}
                  </div>
                  <Donut frac={withRule ? d.counts["em-dia"] / withRule : 0} center={withRule ? `${Math.round((d.counts["em-dia"] / withRule) * 100)}%` : "—"} sub="em dia" size="h-32 w-32" />
                </div>
              );
            })()}
          </OverviewCard>

          <OverviewCard title={`Ranking dos motoristas — ${pLabel}`} to="/frota/notas" linkLabel="Abrir Abastecimento" hint="% das notas de abastecimento entregues (foto do cupom); os últimos 2 dias ainda estão no prazo" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <div className="flex items-baseline gap-2">
              <Big value={rank.overall == null ? "—" : `${rank.overall}%`} />
              <span className="text-xs text-muted-foreground">das notas entregues</span>
            </div>
            <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-hidden">
              {rank.loading && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!rank.loading && !rank.ranking.length && <p className="text-xs text-muted-foreground">Sem abastecimentos no período.</p>}
              {rank.ranking.slice(0, 5).map((r, i) => (
                <div key={r.key} className="grid grid-cols-[1rem_minmax(0,1fr)_2.2rem] items-center gap-2 text-[11px]" title={`${r.name}: ${r.delivered} entregues, ${r.pending} pendentes`}>
                  <span className="tabular-nums text-muted-foreground">{i + 1}º</span>
                  <span className="min-w-0">
                    <span className="block truncate">{r.name}</span>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="ov-grow block h-full rounded-full bg-foreground" style={{ width: `${r.score}%` }} /></span>
                  </span>
                  <span className="text-right font-semibold tabular-nums">{r.score}%</span>
                </div>
              ))}
            </div>
          </OverviewCard>


          </div>
          <ForkliftTransfer ref={transfer} />
        </div>
      )}
    </div>
  );
}

const COST_PARTS = [
  { key: "fuel", label: "Combustível" }, { key: "maint", label: "Manutenção" }, { key: "toll", label: "Pedágio" }, { key: "rent", label: "Locação" },
] as const;
const TONES = ["bg-foreground", "bg-foreground/65", "bg-foreground/40", "bg-foreground/20"];

/** Calendário do mês: manutenções/revisões programadas por dia e a semana sugerida para marcar a revisão em destaque. */
function MaintCalendar({ ym, calFrom, calTo, range, today, maintDays, suggestions, selected, onSelect }: {
  ym: string; calFrom: string; calTo: string; range: { from: string; to: string }; today: string;
  maintDays: Map<string, { plate: string; kind: "man" | "rev" }[]>; suggestions: Suggestion[];
  selected: string; onSelect: (dt: string, element: HTMLElement, upper: boolean) => void;
}) {
  const days = daysBetween(calFrom, calTo);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const byWeek = new Map<string, Suggestion[]>();
  for (const s of suggestions) byWeek.set(s.week, [...(byWeek.get(s.week) ?? []), s]);
  // Sugestões de semanas fora do mês (ex.: próximo mês) aparecem embaixo.
  const outside = suggestions.filter((s) => s.week < calFrom || s.week > calTo).sort((a, b) => a.due.localeCompare(b.due));
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" onClick={(e) => e.preventDefault()}>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.6fr)] gap-1 text-[10px] text-background/60">
        {WD.map((w, i) => <span key={i} className="text-center font-medium">{w}</span>)}
        <span className="pl-1 font-medium">Sugestão de revisão</span>
      </div>
      <div className="mt-1 grid min-h-0 flex-1 auto-rows-fr gap-1">
        {weeks.map((wk, wi) => {
          const sug = byWeek.get(wk[0]!) ?? [];
          return (
            <div key={wk[0]} className={cn("grid min-h-0 grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.6fr)] gap-1 rounded-lg p-0.5 transition-colors",
              sug.length && "bg-background/15 ring-1 ring-background/50")}>
              {wk.map((dt) => {
                const ev = maintDays.get(dt) ?? [];
                const inMonth = dt.startsWith(ym);
                const inRange = dt >= range.from && dt <= range.to;
                return (
                  <Button variant="ghost" key={dt} aria-label={`Selecionar dia ${brDay(dt)}`} aria-pressed={selected === dt} onClick={(e) => onSelect(dt, e.currentTarget, wi < weeks.length / 2)} title={ev.length ? ev.map((e) => `${e.plate} · ${e.kind === "rev" ? "Revisão" : "Manutenção"}`).join("\n") : brDay(dt)}
                    className={cn("h-full w-full min-w-0 items-stretch justify-start whitespace-normal flex min-h-0 flex-col gap-0.5 overflow-hidden rounded-md px-1 py-0.5 text-background hover:bg-background/20", selected === dt && "ring-2 ring-background bg-background/20", inMonth ? "bg-background/5" : "opacity-35",
                      inRange && "outline outline-1 outline-background/60", dt === today && "bg-background/20")}>
                    <span className={cn("text-[10px] tabular-nums", dt === today ? "font-bold" : "text-background/70")}>{Number(dt.slice(8, 10))}</span>
                    {ev.slice(0, 2).map((e, i) => (
                      <span key={i} className={cn("truncate rounded px-1 text-[9px] font-semibold leading-tight", e.kind === "rev" ? "bg-background text-foreground" : "bg-background/30 text-background")}>{e.plate}</span>
                    ))}
                    {ev.length > 2 && <span className="text-[9px] text-background/60">+{ev.length - 2}</span>}
                  </Button>
                );
              })}
              <div className="flex min-h-0 flex-col justify-center overflow-hidden pl-1 text-[10px]">
                {sug.slice(0, 2).map((s) => (
                  <span key={s.vehicleId} className="truncate" title={`${s.plate}: ${s.reason} (vencimento previsto ${brDay(s.due)})`}>
                    <b>{s.plate}</b> <span className="text-background/60">· {s.reason}</span>
                  </span>
                ))}
                {sug.length > 2 && <span className="text-background/60">+{sug.length - 2} veículos</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-background/60">
        <span className="flex items-center gap-1"><span className="rounded bg-background/30 px-1 font-semibold text-background">ABC</span> manutenção</span>
        <span className="flex items-center gap-1"><span className="rounded bg-background px-1 font-semibold text-foreground">ABC</span> revisão</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-background/15 ring-1 ring-background/50" /> semana sugerida para marcar a revisão</span>
        {outside.length > 0 && <span className="ml-auto truncate">Depois: {outside.slice(0, 3).map((s) => `${s.plate} (sem. ${brDay(s.week)})`).join(", ")}</span>}
      </div>
    </div>
  );
}

const H0 = 5 * 60, H1 = 22 * 60;
/** Linha do tempo das demandas da Logística (5h–22h): um dia = por veículo/transportadora; vários dias = por dia. */
function LogTimeline({ list, addr, vehicles, single }: { list: LogDemand[]; addr: Map<string, string>; vehicles: Map<string, string>; single: boolean }) {
  const groups = new Map<string, LogDemand[]>();
  for (const dm of list) {
    const x = dm as any;
    const key = single ? (x.vehicle_id ? vehicles.get(x.vehicle_id) ?? "Veículo" : x.carrier_name || (x.carrier === "cliente" ? "Cliente" : "Terceiro")) : String(x.scheduled_date);
    groups.set(key, [...(groups.get(key) ?? []), dm]);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const hours = Array.from({ length: (H1 - H0) / 60 / 2 + 1 }, (_, i) => H0 + i * 120);
  if (!rows.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">Nenhuma demanda programada neste dia.</p>
        <p className="text-xs text-muted-foreground"></p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" onClick={(e) => e.preventDefault()}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold tabular-nums"><CountUp value={list.length} /></span>
        <span className="text-xs text-muted-foreground">{list.length === 1 ? "demanda programada" : "demandas programadas"}</span>
      </div>
      <div className="relative mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] text-[10px] text-muted-foreground">
        <span />
        <div className="relative h-4">
          {hours.map((h) => <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }}>{h / 60}h</span>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {rows.map(([key, items], ri) => (
          <div key={key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-0">
            <span className="truncate pr-2 text-[11px] font-medium">{single ? key : brDay(key)}</span>
            <div className="relative h-7 rounded-md bg-muted/60">
              {hours.map((h) => <span key={h} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }} />)}
              {items.map((dm, i) => {
                const x = dm as any;
                const span = timeSpan(dm);
                const a = span ? Math.max(H0, span.start) : H0, b = span ? Math.min(H1, span.end) : H0 + 60;
                const where = [addr.get(x.origin_id), addr.get(x.dest_id)].filter(Boolean).join(" → ");
                return (
                  <span key={x.id} className="tile-snap absolute inset-y-0.5 flex items-center overflow-hidden rounded bg-foreground px-1.5 text-[10px] font-medium text-background"
                    style={{ left: `${((a - H0) / (H1 - H0)) * 100}%`, width: `${Math.max(3, ((b - a) / (H1 - H0)) * 100)}%`, animationDelay: `${100 + (ri * 3 + i) * 60}ms` }}
                    title={`${x.title} · ${KIND_LABEL[x.kind] ?? x.kind}${where ? ` · ${where}` : ""}${x.departure_time ? ` · ${String(x.departure_time).slice(0, 5)}` : " · sem horário"}${!single && x.vehicle_id ? ` · ${vehicles.get(x.vehicle_id) ?? ""}` : ""}`}>
                    <span className="truncate">{x.title}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { useWorkScope } from "@/hooks/use-work-scope";
import { Big, Donut, HoverBars, LineArea, MarginLine, OverviewCard, RankBars } from "@/components/overview/charts";
import { PatioCalendar } from "@/components/overview/patio-calendar";
import { RdoTiles, type TileCol } from "@/components/overview/rdo-tiles";
import { cn } from "@/lib/utils";
import { ClientsMap } from "@/components/overview/clients-map";
import { isInternalClient } from "@/lib/fleet-budget";
import { loadResultShared } from "@/lib/results-engine";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { directorSummary } from "@/lib/director-overview";

export const Route = createFileRoute("/_authenticated/atividades")({
  head: () => ({
    meta: [
      { title: "Atividades | AB5 Hub" },
      { name: "description", content: "Visão geral de faturamento, margem, RDOs e clientes no mapa." },
      { property: "og:title", content: "Atividades | AB5 Hub" },
      { property: "og:description", content: "Visão geral de faturamento, margem, RDOs e clientes no mapa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AtividadesOverview,
});

type Period = "mes" | "anterior" | "ano" | "ano_anterior";
const PERIODS: { key: Period; label: string }[] = [
  { key: "mes", label: "Mês atual" }, { key: "anterior", label: "Mês anterior" }, { key: "ano", label: "Este ano" }, { key: "ano_anterior", label: "Ano anterior" },
];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const isoOf = (d: Date) => `${ymOf(d)}-${pad(d.getDate())}`;
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;

/** Período do filtro: dias (mês) ou meses (ano), mais o período anterior equivalente para comparação. */
function periodOf(p: Period, today: Date) {
  const y = today.getFullYear(), m = today.getMonth();
  const todayIso = isoOf(today);
  if (p === "mes" || p === "anterior") {
    const first = p === "mes" ? new Date(y, m, 1) : new Date(y, m - 1, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const end = isoOf(last) < todayIso ? isoOf(last) : todayIso;
    const days: string[] = [];
    for (let d = 1; d <= last.getDate(); d++) { const iso = `${ymOf(first)}-${pad(d)}`; if (iso <= end) days.push(iso); }
    const pf = new Date(first.getFullYear(), first.getMonth() - 1, 1);
    return { unit: "day" as const, from: isoOf(first), to: end, buckets: days, yms: [ymOf(first)], prevFrom: isoOf(pf), prevTo: isoOf(new Date(pf.getFullYear(), pf.getMonth(), Math.min(today.getDate(), 31))) };
  }
  const yy = p === "ano" ? y : y - 1;
  const lastM = p === "ano" ? m : 11;
  const yms = Array.from({ length: lastM + 1 }, (_, i) => `${yy}-${pad(i + 1)}`);
  const to = p === "ano" ? todayIso : `${yy}-12-31`;
  return { unit: "month" as const, from: `${yy}-01-01`, to, buckets: yms, yms, prevFrom: `${yy - 1}-01-01`, prevTo: `${yy - 1}${to.slice(4)}` };
}

/** Visão geral do módulo Atividades: cada cartão resume uma página e leva até ela. */
function AtividadesOverview() {
  const { canAccess } = useAccess();
  const scope = useWorkScope();
  const [period, setPeriod] = useState<Period>("mes");
  const today = new Date();
  const P = useMemo(() => periodOf(period, today), [period, isoOf(today)]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useQuery({
    queryKey: ["overview", "atividades", P.from, P.to], placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [works, billing, rdos, allocs] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, status, active, order_value, orders, clients(name)").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id, entry_date, amount").eq("category", "faturamento").eq("sync_cancelled", false).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("rdos").select("id, work_id, client_id, report_date, status").gte("report_date", P.from).lte("report_date", P.to).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("daily_allocations").select("id, work_id, collaborator_id, daily_schedules!inner(schedule_date)")
          .gte("daily_schedules.schedule_date", P.from).lte("daily_schedules.schedule_date", P.to).not("work_id", "is", null).order("id").range(a, b)),
      ]);
      return { works, billing, rdos, allocs };
    },
  });

  // Margem média por mês: a mesma conta do Fechamento/Financeiro.
  const canResult = canAccess("/obras/resultado");
  const finStart = P.from, finEnd = P.unit === "day" ? `${P.yms[0]}-${pad(new Date(Number(P.yms[0]!.slice(0, 4)), Number(P.yms[0]!.slice(5, 7)), 0).getDate())}` : `${P.yms[0]!.slice(0, 4)}-12-31`;
  const fWorks = useQuery({ queryKey: ["fin-works"], enabled: canResult, queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [] });
  const holidays = useQuery({ queryKey: ["holidays-dates"], enabled: canResult, queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string) });
  const fActive = useQuery({ queryKey: ["fin-active", finStart, finEnd], placeholderData: keepPreviousData, enabled: canResult, queryFn: () => loadFinanceActive(finStart, finEnd) });
  const shared = useQuery({ queryKey: ["fin-shared"], enabled: canResult, staleTime: 60_000, queryFn: loadResultShared });
  const fList = useMemo(() => financeList(fWorks.data ?? [], fActive.data, finStart, finEnd).filter((w: any) => scope.allowWork(w)), [fWorks.data, fActive.data, finStart, finEnd, scope.allowWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => financeBatches(fList), [fList]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey, finEnd], placeholderData: keepPreviousData, staleTime: 60_000,
    enabled: canResult && !!shared.data && !!fActive.data,
    queryFn: () => loadFinanceRaws(batches, shared.data!, { until: finEnd }),
  });
  const margin = useMemo(() => {
    if (!raws.data) return null;
    const s = directorSummary(fList, raws.data, P.yms, holidays.data ?? [], fWorks.data ?? []);
    const months = s.months.filter((m) => m.pct != null);
    const avg = months.length ? months.reduce((a, m) => a + m.pct!, 0) / months.length : null;
    return { avg, months: s.months, clients: (s.clients ?? []).filter((c: any) => c.comp > 0 && c.pct != null).sort((a: any, b: any) => b.comp - a.comp) };
  }, [raws.data, fList, P.yms, holidays.data, fWorks.data]);

  const workforceQ = useQuery({ queryKey: ["active-collaborators-count"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("collaborators").select("id", { count: "exact", head: true }).eq("status", "active")).count ?? 0 });
  const mapQ = useQuery({ queryKey: ["clients-map"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("clients").select("id, name, city, lat, lon").not("lat", "is", null)).data ?? [] });

  const d = useMemo(() => {
    if (!q.data || !scope.ready) return null;
    const works = q.data.works.filter((w) => scope.allowWork(w));
    const workBy = new Map(works.map((w) => [w.id, w]));
    const billing = q.data.billing.filter((e) => workBy.has(e.work_id));
    const keyOf = (iso: string) => (P.unit === "day" ? iso.slice(0, 10) : iso.slice(0, 7));
    // Faturado no período e no período anterior equivalente
    let cur = 0, prev = 0;
    const byBucket = new Map(P.buckets.map((b) => [b, 0]));
    const byClient = new Map<string, number>(), byClientId = new Map<string, number>();
    for (const e of billing) {
      const dt = String(e.entry_date).slice(0, 10), v = Number(e.amount ?? 0);
      if (dt >= P.from && dt <= P.to) {
        cur += v;
        const k = keyOf(dt); if (byBucket.has(k)) byBucket.set(k, byBucket.get(k)! + v);
        const w = workBy.get(e.work_id);
        const n = w?.clients?.name ?? "—"; byClient.set(n, (byClient.get(n) ?? 0) + v);
        if (w?.client_id) byClientId.set(w.client_id, (byClientId.get(w.client_id) ?? 0) + v);
      } else if (dt >= P.prevFrom && dt <= P.prevTo) prev += v;
    }
    // Saldo a faturar no fim do período: pedidos com data até o fim do período (sem data = sempre) menos o faturado até essa data.
    const active = works.filter((w) => w.active && w.status !== "cancelled" && w.status !== "completed");
    const billedUntil = new Map<string, number>();
    for (const e of billing) if (String(e.entry_date).slice(0, 10) <= P.to) billedUntil.set(e.work_id, (billedUntil.get(e.work_id) ?? 0) + Number(e.amount ?? 0));
    const orderedUntil = (w: any) => {
      const list = Array.isArray(w.orders) ? (w.orders as { value?: unknown; date?: unknown }[]) : [];
      if (!list.length) return Number(w.order_value ?? 0);
      return list.reduce((a, o) => a + (!o?.date || String(o.date).slice(0, 10) <= P.to ? Number(o?.value) || 0 : 0), 0);
    };
    let ordered = 0, openBalance = 0;
    for (const w of active) { const o = orderedUntil(w); if (o > 0) { ordered += o; openBalance += Math.max(0, o - (billedUntil.get(w.id) ?? 0)); } }
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

    // RDOs: clientes com atividade (MO escalada) no mês = índice máximo; preenchido = clientes com RDO no dia (ou média por dia útil no mês).
    const clientOf = (wid: string) => { const w = workBy.get(wid); return w && w.client_id && !/^(adm|comercial)$/i.test(String(w.clients?.name ?? "").trim()) ? w.client_id as string : null; };
    const activeIds = new Set<string>(byClientId.keys());
    const activeByMonth = new Map<string, Set<string>>(), activeByDay = new Map<string, Set<string>>();
    for (const a of q.data.allocs) {
      const c = clientOf(a.work_id); if (!c) continue;
      const dt = String(a.daily_schedules?.schedule_date ?? "").slice(0, 10); if (!dt) continue;
      const m = dt.slice(0, 7);
      (activeByMonth.get(m) ?? activeByMonth.set(m, new Set()).get(m)!).add(c);
      (activeByDay.get(dt) ?? activeByDay.set(dt, new Set()).get(dt)!).add(c);
      if (dt >= P.from && dt <= P.to) activeIds.add(c);
    }
    // Serviços com alocação e pessoas escaladas por dia (ou mês).
    const svcBy = new Map<string, Set<string>>(P.buckets.map((b) => [b, new Set<string>()]));
    const pplBy = new Map<string, number>(P.buckets.map((b) => [b, 0]));
    const svcAll = new Set<string>(), daysBy = new Map<string, Set<string>>();
    const isPatio = (wid: string) => (workBy.get(wid)?.clients?.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim() === "PATIO";
    const patioBy = new Map<string, Set<string>>(P.buckets.map((b) => [b, new Set<string>()])), patioAll = new Set<string>();
    for (const a of q.data.allocs) {
      if (a.collaborator_id && workBy.has(a.work_id) && isPatio(a.work_id)) {
        const dt0 = String(a.daily_schedules?.schedule_date ?? "").slice(0, 10), k0 = keyOf(dt0);
        if (patioBy.has(k0)) { patioBy.get(k0)!.add(a.collaborator_id); patioAll.add(a.collaborator_id); }
      }
      if (!workBy.has(a.work_id)) continue;
      const dt = String(a.daily_schedules?.schedule_date ?? "").slice(0, 10); if (!dt) continue;
      const k = keyOf(dt); if (!svcBy.has(k)) continue;
      svcBy.get(k)!.add(a.work_id); svcAll.add(a.work_id); pplBy.set(k, pplBy.get(k)! + 1);
      (daysBy.get(k) ?? daysBy.set(k, new Set()).get(k)!).add(dt);
    }
    const bLabel = (b: string) => (P.unit === "day" ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${monthLabel(b)}/${b.slice(2, 4)}`);
    const svcSeries = P.buckets.map((b) => ({ label: bLabel(b), value: svcBy.get(b)!.size }));
    const pplSeries = P.buckets.map((b) => ({ label: bLabel(b), tip: P.unit === "day" ? bLabel(b) : `${bLabel(b)} (média por dia)`, value: Math.round(pplBy.get(b)! / Math.max(1, daysBy.get(b)?.size ?? 1)) }));
    const rdoDay = new Map<string, Map<string, boolean>>(); // dia → cliente → finalizado?
    for (const r of q.data.rdos) {
      const c = clientOf(r.work_id) ?? (r.client_id && scope.allowClient(r.client_id) ? (r.client_id as string) : null);
      if (!c) continue;
      const dt = String(r.report_date).slice(0, 10);
      if (dt >= P.from && dt <= P.to) activeIds.add(c);
      const m = rdoDay.get(dt) ?? new Map<string, boolean>(); m.set(c, (m.get(c) ?? false) || r.status === "finalized"); rdoDay.set(dt, m);
    }
    const cols: TileCol[] = P.buckets.map((b) => {
      if (P.unit === "day") {
        const max = activeByMonth.get(b.slice(0, 7))?.size ?? 0;
        const m = rdoDay.get(b); let fin = 0, draft = 0;
        m?.forEach((f) => (f ? fin++ : draft++));
        return { key: b, label: String(Number(b.slice(8, 10))), title: `${b.slice(8, 10)}/${b.slice(5, 7)}`, max, fin, draft, expected: activeByDay.get(b)?.size ?? 0 };
      }
      const max = activeByMonth.get(b)?.size ?? 0;
      const days = [...activeByDay.keys()].filter((x) => x.startsWith(b));
      let fin = 0, draft = 0, exp = 0;
      for (const x of days) { exp += activeByDay.get(x)!.size; rdoDay.get(x)?.forEach((f) => (f ? fin++ : draft++)); }
      const n = Math.max(1, days.length);
      return { key: b, label: monthLabel(b), title: `${monthLabel(b)}/${b.slice(2, 4)}`, max, fin: Math.round(fin / n), draft: Math.round(draft / n), expected: Math.round(exp / n), totalFin: fin, totalDraft: draft, totalExpected: exp };
    });

    return {
      patioDays: P.buckets.map((b) => ({ key: b, label: P.unit === "day" ? String(Number(b.slice(8, 10))) : monthLabel(b), title: bLabel(b), value: patioBy.get(b)!.size })), patioCount: patioAll.size,
      byClientId, activeIds, svcSeries, pplSeries, svcCount: svcAll.size, cur, prev, ordered, openBalance, top, cols,
      series: P.buckets.map((b) => ({ label: P.unit === "day" ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${monthLabel(b)}/${b.slice(2, 4)}`, a: byBucket.get(b) ?? 0 })),
      activeCount: active.length, clientCount: new Set(active.map((w) => w.client_id)).size,
      statusBars: [["Planejados", "planned"], ["Ativos", "active"], ["Pausados", "paused"], ["Concluídos", "completed"]].map(([l, s]) => ({ label: l!, value: works.filter((w) => w.status === s).length })),
    };
  }, [q.data, scope.ready, P]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mapa: clientes com endereço localizado (sem os internos da sede), marcador do tamanho do faturado no período.
  const mapClients = useMemo(() => (mapQ.data ?? [])
    .filter((c: any) => scope.ready && scope.allowClient(c.id) && !isInternalClient(c.name ?? ""))
    .map((c: any) => ({ id: c.id, name: c.name, city: c.city, lat: Number(c.lat), lon: Number(c.lon), billed: d?.byClientId.get(c.id) ?? 0, active: d?.activeIds.has(c.id) ?? false })),
  [mapQ.data, scope.ready, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = (u: string) => canAccess(u);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const pLabel = PERIODS.find((x) => x.key === period)!.label.toLowerCase();
  const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

  return (
    <div className={cn("space-y-5 transition-opacity duration-300", (q.isPlaceholderData || raws.isPlaceholderData) && "opacity-70")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Atividades</h1>
          <p className="text-sm text-muted-foreground">Visão geral de clientes, resultados e relatórios diários. Clique em um quadro para abrir a página.</p>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {can("/obras/resultado") && (
              <OverviewCard dark title={`Faturado — ${pLabel}`} to="/obras/resultado" linkLabel="Ver resultados" hint="Notas lançadas nos serviços no período, comparadas ao período anterior equivalente">
                <Big dark value={brl(d.cur)} delta={delta(d.cur, d.prev)} />
                <div className="mt-3"><HoverBars dark data={d.series.map((s) => ({ label: s.label, value: s.a }))} format={brl} /></div>
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title={P.unit === "day" ? "Faturamento por dia" : "Faturamento por mês"} to="/obras/resultado" linkLabel="Abrir Resultados" hint="Notas lançadas nos serviços no período">
                <LineArea height="h-28" data={d.series} format={(p) => brl(p.a)} />
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title="Margem média dos serviços por mês" to="/fechamentos/financeiro" linkLabel="Ver financeiro" hint="Média da margem de contribuição de cada mês do período (mesma conta do Financeiro)">
                {margin ? (
                  <>
                    <Big value={fmtPct(margin.avg)} />
                    <p className="text-xs text-muted-foreground">{margin.months.length > 1 ? `média de ${margin.months.filter((m) => m.pct != null).length} meses` : "no mês"}</p>
                    <div className="mt-2"><MarginLine data={P.unit === "day"
                      ? margin.clients.map((c: any) => ({ label: c.name, pct: c.pct }))
                      : margin.months.filter((m) => m.pct != null).map((m) => ({ label: `${monthLabel(m.ym)}/${m.ym.slice(2, 4)}`, pct: m.pct! }))} /></div>
                  </>
                ) : <div className="h-16 animate-pulse rounded-lg bg-muted" />}
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title="Saldo a faturar" to="/obras/resultado" linkLabel="Ver resultados" hint="Pedidos dos serviços ativos com data até o fim do período menos o faturado neles até essa data">
                <div className="grid grid-cols-2 items-center gap-3">
                  <div className="min-w-0">
                    <Big value={brl(d.openBalance)} />
                    <p className="text-xs text-muted-foreground">de {brl(d.ordered)} em pedidos até {P.to.slice(8, 10)}/{P.to.slice(5, 7)}/{P.to.slice(0, 4)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Faturado: {brl(d.ordered - d.openBalance)}</p>
                  </div>
                  <Donut frac={d.ordered ? (d.ordered - d.openBalance) / d.ordered : 0} center={d.ordered ? `${Math.round(((d.ordered - d.openBalance) / d.ordered) * 100)}%` : "—"} sub="faturado" size="h-36 w-36" />
                </div>
              </OverviewCard>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {can("/obras") && (
              <OverviewCard dark title="Clientes no mapa" to="/clientes" linkLabel="Ver clientes" hint="Marcador do tamanho do faturado no período; clique num cliente da lista para aproximar">
                {mapClients.length > 0 ? (
                  <div onClick={(e) => e.preventDefault()}>
                    <ClientsMap clients={mapClients} className="h-[430px] w-full rounded-xl" />
                  </div>
                ) : <p className="py-8 text-center text-xs text-background/70">Nenhum cliente com endereço localizado.</p>}
              </OverviewCard>
            )}
            <div className="flex flex-col gap-4">
              {can("/externo/relatorio-diario") && (
                <OverviewCard title={P.unit === "day" ? "RDOs por dia" : "RDOs por mês (média por dia)"} to="/externo/relatorio-diario" linkLabel="Abrir Relatório Diário"
                  hint="Altura = clientes com equipe escalada no mês; cada quadradinho é um cliente com RDO">
                  <div onClick={(e) => e.preventDefault()}><RdoTiles cols={d.cols} unit={P.unit} /></div>
                </OverviewCard>
              )}
              {can("/obras") && (
                <OverviewCard className="flex-1" title="Pessoas no Pátio" to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas escaladas no cliente Pátio; cor mais forte = mais pessoas no dia">
                  <div onClick={(e) => e.preventDefault()}><PatioCalendar days={d.patioDays} unit={P.unit} total={d.patioCount} workforce={workforceQ.data ?? 0} /></div>
                </OverviewCard>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {can("/obras") && (
              <OverviewCard title={`Clientes que mais faturaram — ${pLabel}`} to="/clientes" linkLabel="Ver clientes">
                {d.top.length ? <RankBars rows={d.top} format={brl} /> : <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma nota lançada no período.</p>}
              </OverviewCard>
            )}
            {can("/obras") && (
              <OverviewCard title={P.unit === "day" ? "Pessoas escaladas por dia" : "Pessoas escaladas por dia (média do mês)"} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Alocações em serviços na Programação">
                <Big value={Math.round(d.pplSeries.reduce((a, x) => a + x.value, 0) / Math.max(1, d.pplSeries.filter((x) => x.value > 0).length))} />
                <p className="text-xs text-muted-foreground">média por dia com equipe</p>
                <div className="mt-3"><HoverBars data={d.pplSeries} format={(v) => `${v} pessoas`} height="h-20" /></div>
              </OverviewCard>
            )}
            {can("/obras") && (
              <OverviewCard title="Serviços com equipe" to="/obras" linkLabel="Ver serviços" hint="Serviços com pessoas escaladas no período (por dia no mês; por mês no ano)">
                <Big value={d.svcCount} />
                <p className="text-xs text-muted-foreground">serviços com alocação {P.unit === "day" ? "no mês" : "no período"}</p>
                <div className="mt-3"><LineArea height="h-16" data={d.svcSeries.map((x) => ({ label: x.label, a: x.value }))} format={(x) => `${x.a} serviços`} /></div>
              </OverviewCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}


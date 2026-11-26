import { FitScreen } from "@/components/overview/fit-screen";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/use-auth";
import { laborSplit } from "@/lib/hub-labor";
import { FIN_TAX } from "@/lib/finance-data";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { MENU_GROUPS } from "@/lib/menu";
import { useWorkScope } from "@/hooks/use-work-scope";
import { Big, Donut, HoverBars, LineArea, MultiLine, OverviewCard, type LineSeries } from "@/components/overview/charts";
import { RdoTiles, type TileCol } from "@/components/overview/rdo-tiles";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/count-up";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { isInternalClient } from "@/lib/fleet-budget";
import { KM_RATE } from "@/lib/results-engine";

// Mapa (Leaflet/animação) carregado à parte: os outros quadros não esperam por ele.
const ClientsMap = lazy(() => import("@/components/overview/clients-map").then((m) => ({ default: m.ClientsMap })));

/** Cadastros que não mudam com o filtro: lidos uma vez e guardados (trocar o período não relê). */
const STATIC = 5 * 60_000;
type PeriodData = { allocs: any[]; wf: any[]; rdos: any[]; costs: any[]; km: Map<string, number> };
/** Dados do período numa só chamada (função overview_period_data, migração 0188), no formato que a tela já usava. */
async function loadPeriod(from: string, to: string): Promise<PeriodData> {
  const { data, error } = await (supabase.rpc as any)("overview_period_data", { _from: from, _to: to });
  if (error) throw error;
  const r = (data ?? {}) as { allocs?: any[]; wf?: any[]; rdos?: any[]; costs?: any[]; km?: any[] };
  return {
    allocs: (r.allocs ?? []).map(([dt, work_id, collaborator_id]) => ({ work_id, collaborator_id, daily_schedules: { schedule_date: dt } })),
    wf: (r.wf ?? []).map(([collaborator_id, work_id, report_date, worked_hours]) => ({ collaborator_id, work_id, report_date, worked_hours })),
    rdos: (r.rdos ?? []).map(([report_date, work_id, client_id, fin]) => ({ report_date, work_id, client_id, status: fin ? "finalized" : "draft" })),
    costs: (r.costs ?? []).map(([entry_date, work_id, category, amount]) => ({ entry_date, work_id, category, amount })),
    km: new Map((r.km ?? []).map(([dt, km]) => [String(dt), Number(km) || 0])),
  };
}
const periodKey = (from: string, to: string) => ["overview", "atividades-period", from, to];
const EXP_SERIES: LineSeries[] = [
  { key: "mo", label: "Mão de obra", stroke: "stroke-foreground", width: 2, area: true },
  { key: "tr", label: "Transporte", stroke: "stroke-muted-foreground", dash: "3 2" },
  { key: "mat", label: "Materiais + ferramentas", stroke: "stroke-foreground/45", width: 1.5 },
];

export const Route = createFileRoute("/_authenticated/atividades")({
  pendingComponent: DashboardSkeleton,
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
  const { role, loading: roleLoading } = useCurrentUser();
  const { canAccess: canOpen, loading: accessLoading } = useAccess();
  const nav = useNavigate();
  const allowed = role === "admin" || role === "coordenador";
  // Sem a visão geral: vai para a 1ª página do módulo Atividades que a pessoa acessa (ex.: só o Relatório Diário).
  useEffect(() => {
    if (roleLoading || accessLoading || allowed) return;
    const first = MENU_GROUPS.find((g) => g.overview === "/atividades")?.items.find((i) => canOpen(i.url));
    nav({ to: (first ? first.to ?? first.url : "/dashboard") as never, replace: true });
  }, [roleLoading, accessLoading, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (roleLoading || accessLoading) return <DashboardSkeleton />;
  if (!allowed) return null;
  return <HubOverview />;
}

function HubOverview() {
  const { canAccess } = useAccess();
  const scope = useWorkScope();
  const [period, setPeriod] = useState<Period>("mes");
  const today = new Date();
  const P = useMemo(() => periodOf(period, today), [period, isoOf(today)]); // eslint-disable-line react-hooks/exhaustive-deps

  const qc = useQueryClient();
  const worksQ = useQuery({ queryKey: ["overview", "works"], staleTime: STATIC, queryFn: () => fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, status, active, order_value, orders, clients(name)").order("id").range(a, b)) });
  const billingQ = useQuery({ queryKey: ["overview", "billing"], staleTime: 2 * 60_000, queryFn: () => fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id, entry_date, amount").eq("category", "faturamento").eq("sync_cancelled", false).order("id").range(a, b)) });
  const peopleQ = useQuery({ queryKey: ["overview", "people-rates"], staleTime: STATIC, queryFn: () => fetchAll<any>((a, b) => supabase.from("collaborators").select("id, salary, contract_type").order("id").range(a, b)) });
  const holQ = useQuery({ queryKey: ["overview", "holidays"], staleTime: STATIC, queryFn: () => fetchAll<any>((a, b) => supabase.from("holidays").select("id, date").order("id").range(a, b)) });
  const periodQ = useQuery({
    queryKey: periodKey(P.from, P.to), placeholderData: keepPreviousData,
    staleTime: 2 * 60_000, refetchInterval: 5 * 60_000,
    queryFn: () => loadPeriod(P.from, P.to),
  });
  // Os outros filtros já ficam carregados (em segundo plano, depois do atual) para a troca ser imediata.
  const prefetch = (p: Period) => { const x = periodOf(p, today); void qc.prefetchQuery({ queryKey: periodKey(x.from, x.to), queryFn: () => loadPeriod(x.from, x.to), staleTime: 2 * 60_000 }); };
  useEffect(() => {
    if (!periodQ.data || periodQ.isPlaceholderData) return;
    const t = window.setTimeout(() => PERIODS.forEach((p) => p.key !== period && prefetch(p.key)), 600);
    return () => window.clearTimeout(t);
  }, [!!periodQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = { data: worksQ.data && billingQ.data && peopleQ.data && holQ.data && periodQ.data
    ? { works: worksQ.data, billing: billingQ.data, people: peopleQ.data, hol: holQ.data, ...periodQ.data } : undefined };

  const clientsQ = useQuery({ queryKey: ["overview", "clients"], staleTime: STATIC, queryFn: async () => (await supabase.from("clients").select("id, name").eq("active", true)).data ?? [] });
  const mapQ = useQuery({ queryKey: ["clients-map"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("clients").select("id, name, city, lat, lon").not("lat", "is", null)).data ?? [] });

  const d = useMemo(() => {
    if (!q.data || !scope.ready) return null;
    const works = q.data.works.filter((w) => scope.allowWork(w));
    const workBy = new Map(works.map((w) => [w.id, w]));
    const billing = q.data.billing.filter((e) => workBy.has(e.work_id));
    const keyOf = (iso: string) => (P.unit === "day" ? iso.slice(0, 10) : iso.slice(0, 7));
    // Faturado no período e no período anterior equivalente
    // Serviços atendidos no período: com faturamento, escalação ou RDO (internos fora no quadro).
    const servedWorks = new Set<string>();
    let cur = 0, prev = 0;
    const byBucket = new Map(P.buckets.map((b) => [b, 0]));
    const byClient = new Map<string, number>(), byClientId = new Map<string, number>();
    for (const e of billing) {
      const dt = String(e.entry_date).slice(0, 10), v = Number(e.amount ?? 0);
      if (dt >= P.from && dt <= P.to) {
        cur += v; servedWorks.add(e.work_id);
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
      svcBy.get(k)!.add(a.work_id); svcAll.add(a.work_id); servedWorks.add(a.work_id); pplBy.set(k, pplBy.get(k)! + 1);
      (daysBy.get(k) ?? daysBy.set(k, new Set()).get(k)!).add(dt);
    }
    const bLabel = (b: string) => (P.unit === "day" ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${monthLabel(b)}/${b.slice(2, 4)}`);
    const svcSeries = P.buckets.map((b) => ({ label: bLabel(b), value: svcBy.get(b)!.size }));
    const pplSeries = P.buckets.map((b) => ({ label: bLabel(b), tip: P.unit === "day" ? bLabel(b) : `${bLabel(b)} (média por dia)`, value: Math.round(pplBy.get(b)! / Math.max(1, daysBy.get(b)?.size ?? 1)) }));
    const rdoDay = new Map<string, Map<string, boolean>>(); // dia → cliente → finalizado?
    for (const r of q.data.rdos) { const dt0 = String(r.report_date).slice(0, 10); if (r.work_id && workBy.has(r.work_id) && dt0 >= P.from && dt0 <= P.to) servedWorks.add(r.work_id); }
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

    // Despesas por dia (MO das escalações + lançamentos de custo) e MO normal × HE por cliente.
    const hol = new Set<string>((q.data.hol ?? []).map((h: any) => String(h.date)));
    const person = new Map<string, any>((q.data.people ?? []).map((p: any) => [p.id, p]));
    const wfH = new Map<string, number>(), wfDay = new Map<string, number>();
    for (const r of q.data.wf ?? []) { if (r.worked_hours == null) continue; const h = Number(r.worked_hours) || 0; wfH.set(`${r.collaborator_id}|${r.work_id}|${r.report_date}`, h); wfDay.set(`${r.collaborator_id}|${r.report_date}`, (wfDay.get(`${r.collaborator_id}|${r.report_date}`) ?? 0) + h); }
    const costBy = new Map<string, number>(P.buckets.map((b) => [b, 0]));
    const moBy = new Map<string, { normal: number; extra: number }>();
    const laborBy = new Map<string, number>();
    for (const a of q.data.allocs) {
      const w = workBy.get(a.work_id); if (!w || !a.collaborator_id) continue;
      const dt = String(a.daily_schedules?.schedule_date ?? "").slice(0, 10); if (!dt) continue;
      const p = person.get(a.collaborator_id); const rate = Number(p?.salary) || 0; if (!rate) continue;
      const h = wfH.get(`${a.collaborator_id}|${a.work_id}|${dt}`) ?? wfDay.get(`${a.collaborator_id}|${dt}`) ?? 8;
      const sp = laborSplit(h, rate, p?.contract_type === "pj", dt, hol);
      const k = keyOf(dt); if (costBy.has(k)) { costBy.set(k, costBy.get(k)! + sp.normal + sp.extra); laborBy.set(k, (laborBy.get(k) ?? 0) + sp.normal + sp.extra); }
      const cn = w.clients?.name ?? "—"; const m = moBy.get(cn) ?? { normal: 0, extra: 0 }; m.normal += sp.normal; m.extra += sp.extra; moBy.set(cn, m);
    }
    // Lançamentos de custo (compras/materiais, MO lançada, ferramentas…) não têm dia real (vêm no último dia do mês, competência):
    // na visão por dia são rateados igualmente pelos dias do período filtrado daquele mês — viram uma linha contínua.
    const spread = (dt: string): [string, number][] => {
      if (P.unit !== "day") { const k = keyOf(dt); return costBy.has(k) ? [[k, 1]] : []; }
      const days = P.buckets.filter((b) => b.startsWith(dt.slice(0, 7)));
      return days.map((b) => [b, 1 / days.length]);
    };
    for (const e of q.data.costs ?? []) { if (!workBy.has(e.work_id)) continue; for (const [k, f] of spread(String(e.entry_date).slice(0, 10))) costBy.set(k, costBy.get(k)! + (Number(e.amount) || 0) * f); }
    // Transporte próprio: km rodado × R$ 1,35 (principal = km × 2 × viagens; extras = extra_km); manutenção não conta.
    const expBy = new Map<string, { mo: number; tr: number; mat: number }>(P.buckets.map((b) => [b, { mo: 0, tr: 0, mat: 0 }]));
    for (const [dt, km] of q.data.km) { const k = keyOf(dt.slice(0, 10)); if (costBy.has(k)) { costBy.set(k, costBy.get(k)! + km * KM_RATE); expBy.get(k)!.tr += km * KM_RATE; } }
    for (const e of q.data.costs ?? []) {
      if (!workBy.has(e.work_id)) continue;
      for (const [k, f] of spread(String(e.entry_date).slice(0, 10))) {
        const x = expBy.get(k)!; const v = (Number(e.amount) || 0) * f;
        if (e.category === "mao_obra") x.mo += v; else if (e.category === "materiais" || e.category === "ferramentas") x.mat += v;
      }
    }
    // Imposto de 18,5% sobre todo o faturado do dia.
    for (const b of P.buckets) costBy.set(b, costBy.get(b)! + (byBucket.get(b) ?? 0) * FIN_TAX);
    const moRows = [...moBy.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.normal + b.extra - a.normal - a.extra);
    let ind = 0;
    for (const [n, v] of byClient) if (/^industria$/i.test(n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim())) ind += v;
    return {
      expenses: P.buckets.map((b) => { const x = expBy.get(b)!; return { label: bLabel(b), values: { mo: x.mo + (laborBy.get(b) ?? 0), tr: x.tr, mat: x.mat } }; }),
      billedCost: P.buckets.map((b) => ({ label: bLabel(b), a: byBucket.get(b) ?? 0, b: costBy.get(b) ?? 0 })), moRows, ind,
      patioDays: P.buckets.map((b) => ({ key: b, label: P.unit === "day" ? String(Number(b.slice(8, 10))) : monthLabel(b), title: bLabel(b), value: patioBy.get(b)!.size })), patioCount: patioAll.size,
      servedWorks: [...servedWorks].map((id) => workBy.get(id)).filter((w: any) => w && !isInternalClient(w.clients?.name ?? "")),
      byClientId, activeIds, svcSeries, pplSeries, svcCount: svcAll.size, cur, prev, ordered, openBalance, top, cols,
      series: P.buckets.map((b) => ({ label: P.unit === "day" ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${monthLabel(b)}/${b.slice(2, 4)}`, a: byBucket.get(b) ?? 0 })),
      activeCount: active.length, clientCount: new Set(active.map((w) => w.client_id)).size,
      statusBars: [["Planejados", "planned"], ["Ativos", "active"], ["Pausados", "paused"], ["Concluídos", "completed"]].map(([l, s]) => ({ label: l!, value: works.filter((w) => w.status === s).length })),
    };
  }, [worksQ.data, billingQ.data, peopleQ.data, holQ.data, periodQ.data, scope.ready, P]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mapa: clientes com endereço localizado (sem os internos da sede), marcador do tamanho do faturado no período.
  const mapClients = useMemo(() => (mapQ.data ?? [])
    .filter((c: any) => scope.ready && scope.allowClient(c.id) && !isInternalClient(c.name ?? ""))
    .map((c: any) => ({ id: c.id, name: c.name, city: c.city, lat: Number(c.lat), lon: Number(c.lon), billed: d?.byClientId.get(c.id) ?? 0, active: d?.activeIds.has(c.id) ?? false })),
  [mapQ.data, scope.ready, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = (u: string) => canAccess(u);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const pLabel = PERIODS.find((x) => x.key === period)!.label.toLowerCase();

  return (
    <FitScreen>
    <div className={cn("flex flex-col gap-3 transition-opacity duration-300 lg:h-full", periodQ.isPlaceholderData && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">Atividades</h1>
          <p className="hidden text-xs text-muted-foreground md:block">Clique em um quadro para abrir a página.</p>
        </div>
        <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} onMouseEnter={() => prefetch(p.key)}
              className={cn("rounded-full px-3 py-1 transition-colors duration-300", period === p.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!d ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {can("/obras/resultado") && (
              <OverviewCard dark title={`Faturado — ${pLabel}`} to="/obras/resultado" linkLabel="Ver Resultados" hint="Notas lançadas nos serviços no período, comparadas ao período anterior equivalente">
                <Big dark value={brl(d.cur)} delta={delta(d.cur, d.prev)} />
                <div className="mt-3"><HoverBars dark data={d.series.map((s) => ({ label: s.label, value: s.a }))} format={brl} /></div>
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title={`Despesas — ${pLabel}`} to="/obras/resultado" linkLabel="Ver Resultados" hint="Mão de obra (escalações com encargos e HE + lançamentos de MO), transporte (km × R$ 1,35) e materiais + ferramentas lançados no período">
                {(() => {
                  const t = d.expenses.reduce((a, x) => ({ mo: a.mo + x.values.mo, tr: a.tr + x.values.tr, mat: a.mat + x.values.mat }), { mo: 0, tr: 0, mat: 0 });
                  return (
                    <>
                      <Big value={brl(t.mo + t.tr + t.mat)} />
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-foreground" />MO {brl(t.mo)}</span>
                        <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-muted-foreground" />Transporte {brl(t.tr)}</span>
                        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-foreground/45" />Mat. + ferr. {brl(t.mat)}</span>
                      </div>
                      <MultiLine className="mt-1" height="h-16" data={d.expenses} series={EXP_SERIES} format={brl} />
                    </>
                  );
                })()}
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title={`Clientes que mais faturaram — ${pLabel}`} to="/clientes" linkLabel="Ver Clientes" hint="Notas lançadas nos serviços do cliente no período">
                <ClientBars rows={d.top} limit={4} />
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title={`Clientes atendidos — ${pLabel}`} to="/clientes" linkLabel="Ver Clientes" hint="Clientes com equipe escalada, RDO ou faturamento no período, em relação a todos os clientes ativos do cadastro (sem ADM, Comercial, Pátio e Indústria)">
                {(() => {
                  const all = (clientsQ.data ?? []).filter((c: any) => scope.allowClient(c.id) && !isInternalClient(c.name ?? ""));
                  const served = all.filter((c: any) => d.activeIds.has(c.id)).length;
                  const total = all.length;
                  return (
                    <div className="grid grid-cols-2 items-center gap-3">
                      <div className="min-w-0">
                        <Big value={served} />
                        <p className="text-xs text-muted-foreground">de {total} clientes no cadastro</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Sem atividade: {Math.max(0, total - served)}</p>
                        {(() => {
                          const sw = d.servedWorks.length, done = d.servedWorks.filter((w: any) => w.status === "completed").length;
                          return (
                            <div className="mt-3" title={`${sw} serviços com escalação, RDO ou faturamento no período; ${done} já concluídos`}>
                              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                                <span><span className="font-display text-base font-semibold tabular-nums"><CountUp value={sw} /></span> serviços atendidos</span>
                              </div>
                              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
                                <span className="ov-grow h-full bg-foreground" style={{ width: `${sw ? (done / sw) * 100 : 0}%` }} />
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">{done} concluídos · {sw - done} em andamento</p>
                            </div>
                          );
                        })()}
                      </div>
                      <Donut frac={total ? served / total : 0} center={total ? `${Math.round((served / total) * 100)}%` : "—"} sub="atendidos" size="h-36 w-36" />
                    </div>
                  );
                })()}
              </OverviewCard>
            )}
          </div>

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
            {can("/obras") && (
              <OverviewCard dark className="lg:min-h-0" bodyClassName="flex min-h-0 flex-col" title="Clientes no mapa" to="/clientes" linkLabel="Ver Clientes" hint="Marcador do tamanho do faturado no período; clique num cliente da lista para aproximar">
                {mapClients.length > 0 ? (
                  <div className="min-h-0 flex-1" onClick={(e) => e.preventDefault()}>
                    <Suspense fallback={<div className="h-[340px] w-full animate-pulse rounded-xl bg-background/10 lg:h-full" />}>
                      <ClientsMap fill clients={mapClients} className="h-[340px] w-full rounded-xl lg:h-full" />
                    </Suspense>
                  </div>
                ) : <p className="py-8 text-center text-xs text-background/70">Nenhum cliente com endereço localizado.</p>}
              </OverviewCard>
            )}
            <div className="flex flex-col gap-3 lg:grid lg:min-h-0 lg:grid-rows-2">
              {can("/externo/relatorio-diario") && (
                <OverviewCard className="pb-6 lg:min-h-0" bodyClassName="min-h-0" title={P.unit === "day" ? "RDOs por dia" : "RDOs por mês (média por dia)"} to="/externo/relatorio-diario" linkLabel="Abrir Relatório Diário"
                  hint="Altura = clientes com equipe escalada no mês; cada quadradinho é um cliente com RDO">
                  <div className="h-full min-h-0" onClick={(e) => e.preventDefault()}><RdoTiles fill cols={d.cols} unit={P.unit} /></div>
                </OverviewCard>
              )}
              {can("/obras/resultado") && (
                <OverviewCard className="flex-1 pb-6 lg:min-h-0" bodyClassName="flex min-h-0 flex-col" title={P.unit === "day" ? "Faturado × despesas por dia" : "Faturado × despesas por mês"} to="/obras/resultado" linkLabel="Abrir Resultados" hint="Despesas = imposto de 18,5% do faturado + MO das escalações (com encargos e HE) + transporte (km × R$ 1,35) + materiais, ferramentas, terceiros e andaimes lançados no dia">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <div className="mb-1 flex gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-foreground" />Faturado</span><span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-muted-foreground" />Despesas</span></div>
                      <LineArea height="h-40 lg:h-auto lg:min-h-0 lg:flex-1" className="lg:min-h-[90px] lg:flex-1" data={d.billedCost} format={(p) => `Faturado ${brl(p.a)} · Despesas ${brl(p.b ?? 0)}`} />
                  </div>
                </OverviewCard>
              )}
            </div>
          </div>

        </>
      )}
    </div>
    </FitScreen>
  );
}


/** Clientes que mais faturaram: mesmo desenho do antigo quadro "MO: horas normais × HE" (components/overview/programacao-cards.tsx MoBars). */
function ClientBars({ rows, limit = 99 }: { rows: { label: string; value: number }[]; limit?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const tot = rows.reduce((a, r) => a + r.value, 0);
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma nota lançada no período.</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground" />Faturado {brl(tot)}</span>
      </div>
      {rows.slice(0, limit).map((r) => (
        <div key={r.label} title={`${r.label}: ${brl(r.value)}`}>
          <div className="flex justify-between text-[11px]"><span className="truncate">{r.label}</span><span className="tabular-nums text-muted-foreground">{brl(r.value)}</span></div>
          <div className="mt-0.5 flex h-2 overflow-hidden rounded-full bg-muted" style={{ width: `${(r.value / max) * 100}%` }}>
            <span className="ov-grow h-full w-full bg-foreground" />
          </div>
        </div>
      ))}
    </div>
  );
}

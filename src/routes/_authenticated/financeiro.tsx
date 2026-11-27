import { Fragment, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/use-access";
import { useWorkScope } from "@/hooks/use-work-scope";
import { FitScreen } from "@/components/overview/fit-screen";
import { Donut, OverviewCard, StackBar } from "@/components/overview/charts";
import { CountUp } from "@/components/count-up";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { MultiFilter } from "@/components/multi-filter";
import { FinanceMonthPicker } from "@/components/finance-month-picker";
import { MarginPercent } from "@/components/margin-percent";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadResultShared, monthEnd } from "@/lib/results-engine";
import { buildFinanceGroups, financeBatches, financeList, loadFinanceActive, loadFinanceRaws, type FinanceLine } from "@/lib/finance-data";
import { MARGIN_GOAL } from "@/lib/director-overview";
import { marginPercent } from "@/lib/result-labor";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/financeiro")({
  pendingComponent: DashboardSkeleton,
  head: () => ({
    meta: [
      { title: "Financeiro | AB5 Hub" },
      { name: "description", content: "Resultado do período para a diretoria: faturamento, despesas, margem, pedidos em aberto e horas." },
      { property: "og:title", content: "Financeiro | AB5 Hub" },
      { property: "og:description", content: "Faturamento, despesas, margem de contribuição e resumo das obras por período." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinanceiroOverview,
});

const ResultadoPage = lazy(() => import("@/components/resultado-page").then((m) => ({ default: m.ResultadoPage })));
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EMPTY = new Map<string, any>();
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlK = (v: number) => Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : Math.abs(v) >= 1e4 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : brl(v);
const hrs = (v: number) => `${Math.round(v).toLocaleString("pt-BR")} h`;
const cost = (l: FinanceLine) => l.tax + l.mo + l.transport + l.materials;
/** Pedidos do serviço com data até `end` (sem data = sempre) e quanto deles já foi faturado até essa data. */
function orderOf(l: FinanceLine, end: string) {
  const os = Array.isArray(l.work.orders) ? (l.work.orders as { value?: unknown; date?: unknown }[]) : [];
  const o = os.length ? os.reduce((a, x) => a + (!x?.date || String(x.date).slice(0, 10) <= end ? Number(x?.value) || 0 : 0), 0) : Number(l.work.order_value ?? 0);
  if (o <= 0) return { ordered: 0, billed: 0 };
  const b = (l.raw.entries as any[]).reduce((a, e) => a + (e.category === "faturamento" && String(e.entry_date).slice(0, 10) <= end ? Number(e.amount) || 0 : 0), 0);
  return { ordered: o, billed: Math.min(o, b) };
}
const ordersOf = (ls: FinanceLine[], end: string) => ls.reduce((a, l) => { const o = orderOf(l, end); return { ordered: a.ordered + o.ordered, billed: a.billed + o.billed }; }, { ordered: 0, billed: 0 });
const COST_PARTS = [
  { key: "tax", label: "Impostos", cls: "bg-foreground/15" },
  { key: "mo", label: "Mão de obra", cls: "bg-foreground" },
  { key: "transport", label: "Transporte", cls: "bg-foreground/50" },
  { key: "materials", label: "Materiais", cls: "cost-hatch" },
] as const;

/** Dashboard do Financeiro (26/11): para apresentar à diretoria. Acesso = quem abre o Fechamento. */
function FinanceiroOverview() {
  const { canAccess, loading } = useAccess();
  const nav = useNavigate();
  const allowed = canAccess("/fechamentos/financeiro");
  useEffect(() => { if (!loading && !allowed) nav({ to: "/dashboard", replace: true }); }, [loading, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <DashboardSkeleton />;
  if (!allowed) return null;
  return <Overview />;
}

function Overview() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [months, setMonths] = useState<number[]>([now.getMonth() + 1]);
  const [detail, setDetail] = useState<{ line: FinanceLine; client: boolean } | null>(null);
  // Clientes recolhidos (padrão: todos abertos).
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Mesma lista de clientes ocultos do Fechamento (salva no navegador).
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem("fin-hidden-clients") ?? "[]")); } catch { /* ignore */ } }, []);
  const saveHidden = (h: string[]) => { setHidden(h); localStorage.setItem("fin-hidden-clients", JSON.stringify(h)); };
  const yms = useMemo(() => [...months].sort((a, b) => a - b).map((m) => `${year}-${String(m).padStart(2, "0")}`), [year, months]);
  const start = yms.length ? `${yms[0]}-01` : `${year}-01-01`;
  const end = yms.length ? monthEnd(yms[yms.length - 1]!) : `${year}-12-31`;

  // Mesmas consultas (e chaves) do Fechamento: os números são idênticos e o cache é compartilhado.
  // Último retrato salvo no navegador: abre na hora e as consultas atualizam por trás.
  const works = useQuery({ queryKey: ["fin-works"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [] });
  const holidays = useQuery({ queryKey: ["holidays-dates"], queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string) });
  // O ano inteiro é lido uma vez; trocar meses ou clientes só refaz a conta na tela (instantâneo).
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
  const active = useQuery({ queryKey: ["fin-active", yStart, yEnd], staleTime: 10 * 60_000, placeholderData: (prev) => prev, queryFn: () => loadFinanceActive(yStart, yEnd) });
  const scope = useWorkScope();
  const list = useMemo(() => financeList(works.data ?? [], active.data, yStart, yEnd).filter((w: any) => scope.allowWork(w)), [works.data, active.data, yStart, yEnd, scope.allowWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 10 * 60_000, queryFn: loadResultShared });
  const batches = useMemo(() => financeBatches(list), [list]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey, yEnd], staleTime: 10 * 60_000, placeholderData: (prev) => prev,
    enabled: !!shared.data && !!active.data && !active.isPlaceholderData && !works.isPlaceholderData,
    queryFn: () => loadFinanceRaws(batches, shared.data!, { until: yEnd }),
  });
  const groups = useMemo(() => buildFinanceGroups(list, raws.data ?? EMPTY, yms, year, holidays.data ?? [], works.data ?? []), [list, raws.data, yms, year, holidays.data, works.data]);
  const shown = useMemo(() => groups.filter((g) => !hidden.includes(g.key)), [groups, hidden]);

  const d = useMemo(() => {
    const lines = shown.flatMap((g) => g.lines);
    const s = (f: (l: FinanceLine) => number) => lines.reduce((a, l) => a + f(l), 0);
    const billed = s((l) => l.billed), tax = s((l) => l.tax), mo = s((l) => l.mo), transport = s((l) => l.transport), materials = s((l) => l.materials), margin = s((l) => l.margin);
    // Pedidos até o fim do período (sem data = sempre) × faturado até essa data, por serviço exibido.
    let ordered = 0, billedToDate = 0;
    for (const l of lines) { const o = orderOf(l, end); ordered += o.ordered; billedToDate += o.billed; }
    const hN = s((l) => l.hours.normal), hE = s((l) => l.hours.extra);
    const heByClient = shown.map((g) => ({ name: g.name, n: g.lines.reduce((a, l) => a + l.hours.normal, 0), e: g.lines.reduce((a, l) => a + l.hours.extra, 0) }))
      .filter((x) => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 3);
    const comp = lines.reduce((a, l) => a + (l.monthPct != null && l.margin ? l.margin / (l.monthPct / 100) : 0), 0);
    const pct = marginPercent(margin, comp);
    const below = lines.filter((l) => l.monthPct != null && l.monthPct < MARGIN_GOAL).length;
    return { lines, billed, tax, mo, transport, materials, margin, spent: tax + mo + transport + materials, ordered, billedToDate, open: ordered - billedToDate, hN, hE, heByClient, pct, below };
  }, [shown, end]);

  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - 3 + i));
  const loading = !scope.ready || !works.data || !active.data || (list.length > 0 && !raws.data);
  const stale = raws.isPlaceholderData || active.isPlaceholderData;
  const when = !yms.length ? "Selecione ao menos um mês" : yms.length === 1 ? `${MONTHS[months[0]! - 1]}/${year}` : `${yms.length} meses de ${year}`;
  const maxBilled = Math.max(1, ...shown.map((g) => g.lines.reduce((a, l) => a + l.billed, 0)));

  return (
    <FitScreen>
      <div className={cn("flex flex-col gap-3 transition-opacity duration-300 lg:h-full", stale && "opacity-70")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-xl font-semibold tracking-tight">Financeiro</h1>
            <p className="hidden text-xs text-muted-foreground md:block">{when} · mesma conta do Fechamento (imposto 18,5%)</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <p className="text-xs font-medium">Ano</p>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Meses</p>
              <FinanceMonthPicker value={months} onChange={setMonths} />
            </div>
            <MultiFilter title="Clientes" mode="show" hint="Marque os clientes considerados nos quadros e na tabela."
              options={groups.map((g) => ({ value: g.key, label: g.name }))}
              values={groups.filter((g) => !hidden.includes(g.key)).map((g) => g.key)}
              onChange={(vis) => saveHidden([...hidden.filter((k) => !groups.some((g) => g.key === k)), ...groups.filter((g) => !vis.includes(g.key)).map((g) => g.key)])} />
          </div>
        </div>

        {loading || !yms.length ? (yms.length ? <DashboardSkeleton /> : <p className="text-sm text-muted-foreground">Selecione ao menos um mês.</p>) : (
          <div key={`${year}|${yms.join(",")}|${hidden.join(",")}`} className="grid gap-3 md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-[13.25rem_minmax(0,1fr)]">
            <OverviewCard dark title="Resultado do período" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint="Faturado, todas as despesas e a margem; os % são sobre o faturado" className="min-h-0">
              <div className="invert-scope">
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-[11px] text-muted-foreground">Faturado</p><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.billed)} /></p></div>
                  <div><p className="text-[11px] text-muted-foreground">Despesas</p><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.spent)} /></p></div>
                  <div><p className="text-[11px] text-muted-foreground">Margem</p><p className={cn("font-display text-lg font-semibold tabular-nums", d.margin < 0 && "text-destructive")}><CountUp value={brlK(d.margin)} /></p></div>
                </div>
                <div className="mt-3"><StackBar format={brlK} base={d.billed} parts={[
                  { label: "Impostos", value: d.tax, className: "bg-foreground/25" },
                  { label: "Mão de obra", value: d.mo, className: "bg-foreground" },
                  { label: "Transporte", value: d.transport, className: "bg-foreground/60" },
                  { label: "Materiais", value: d.materials, className: "bg-foreground/40" },
                ]} /></div>
              </div>
            </OverviewCard>

            <OverviewCard dark title="Margem de contribuição" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint={`Margem ÷ faturado por competência; meta ${MARGIN_GOAL}%`} className="min-h-0" bodyClassName="flex min-h-0">
              <div className="invert-scope grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                <BandGauge pct={d.pct} />
                <div className="min-w-0 space-y-2">
                  <div><p className={cn("font-display text-3xl font-semibold leading-none tabular-nums", (d.pct ?? 0) < 0 && "text-destructive")}>{d.pct == null ? "—" : <CountUp value={`${d.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} />}</p><p className="mt-1 text-sm font-semibold tabular-nums">{brlK(d.margin)}</p><p className="text-[10px] text-muted-foreground">{d.below} de {d.lines.length} abaixo da meta</p></div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px] text-muted-foreground">
                    {GAUGE_BANDS.map((x) => <div key={x.label} className="flex items-center gap-1.5"><span className={cn("h-1.5 w-4 rounded-full", x.cls)} />{x.label}</div>)}
                  </div>
                </div>
              </div>
            </OverviewCard>

            <OverviewCard title="Pedidos faturados" to="/fechamentos/suzano" linkLabel="Abrir Pedidos" hint="Pedidos dos serviços exibidos com data até o fim do período × o que já foi faturado neles até essa data" className="min-h-0" bodyClassName="flex items-center">
              <div className="grid w-full grid-cols-2 items-center gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div><p className="font-display text-2xl font-semibold tabular-nums"><CountUp value={brlK(d.ordered)} /></p><p className="text-[11px] text-muted-foreground">em pedidos (todos, até o fim do período)</p></div>
                  <div className="flex gap-4">
                    <div><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.billedToDate)} /></p><p className="text-[11px] text-muted-foreground">faturado deles</p></div>
                    <div><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.open)} /></p><p className="text-[11px] text-muted-foreground">em aberto</p></div>
                  </div>
                </div>
                <Donut frac={d.ordered ? d.billedToDate / d.ordered : 0} center={d.ordered ? `${Math.round((d.billedToDate / d.ordered) * 100)}%` : "—"} sub="faturado" size="h-32 w-32 justify-self-center" />
              </div>
            </OverviewCard>

            <OverviewCard title="Horas normais × extras" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint="Horas de MO dos serviços exibidos: normais = até 8 h em dia útil; extras = acima disso, sábado, domingo e feriado" className="min-h-0">
              <div className="space-y-2.5">
                <div>
                  <div className="flex items-end justify-between">
                    <div><p className="font-display text-2xl font-semibold tabular-nums"><CountUp value={d.hN + d.hE ? `${Math.round((d.hE / (d.hN + d.hE)) * 100)}%` : "—"} /></p><p className="text-[11px] text-muted-foreground">das horas são extras</p></div>
                    <div className="flex gap-4 text-right text-[11px]">
                      <div><p className="font-semibold tabular-nums text-foreground">{hrs(d.hN)}</p><p className="flex items-center justify-end gap-1 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-foreground/25" />normais</p></div>
                      <div><p className="font-semibold tabular-nums text-foreground">{hrs(d.hE)}</p><p className="flex items-center justify-end gap-1 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-foreground" />extras</p></div>
                    </div>
                  </div>
                  <HourBar n={d.hN} e={d.hE} className="mt-2 h-2.5" />
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Clientes com mais hora extra</p>
                  <div className="grid grid-cols-3 gap-2">
                    {d.heByClient.map((c, i) => (
                      <div key={c.name} className="min-w-0 rounded-lg bg-muted/50 px-2 py-1.5" title={`${c.name}: ${hrs(c.e)} extras de ${hrs(c.n + c.e)}`}>
                        <p className="truncate text-[10px] font-medium">{c.name}</p>
                        <p className="font-display text-sm font-semibold tabular-nums">{hrs(c.e)} <span className="text-[9px] font-normal text-muted-foreground">{Math.round((c.e / Math.max(1, c.n + c.e)) * 100)}%</span></p>
                        <HourBar n={c.n} e={c.e} className="mt-1 h-1" delay={i * 90} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </OverviewCard>

            {/* Resumo das obras: colunas com largura fixa, números alinhados à direita, cliente com subtotal (sempre aberto). */}
            <div className="ov-card flex min-h-0 flex-col rounded-2xl border bg-card md:col-span-2 lg:col-span-4">
              <div className="flex items-center justify-between px-5 pt-3 text-xs">
                <p className="font-medium text-muted-foreground">Resumo das obras · {shown.length} clientes · {d.lines.length} serviços</p>
                <p className="text-muted-foreground">Clique no cliente para o resultado geral, no serviço para o detalhe</p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[22rem]" /><col /><col /><col /><col className="w-[12rem]" /><col /><col /><col /><col />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">Cliente / serviço</th>
                      <th className="px-3 text-right font-medium">Faturado</th>
                      <th className="px-3 text-left font-medium" title="Quanto dos pedidos (até o fim do período) já foi faturado">Porcentagem faturada</th>
                      <th className="px-3 text-right font-medium">Despesas</th>
                      <th className="px-3 text-left font-medium normal-case tracking-normal">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">{COST_PARTS.map((x) => <span key={x.key} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-[2px]", x.cls)} />{x.label}</span>)}</div>
                      </th>
                      <th className="px-3 text-right font-medium">Margem</th>
                      <th className="px-3 text-center font-medium">Margem %</th>
                      <th className="px-3 text-left font-medium">Andamento</th>
                      <th className="px-3 text-right font-medium" title="Margem desde o início do serviço até o último mês escolhido">Margem acum.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!shown.length && <tr><td colSpan={9} className="px-3 py-4 text-muted-foreground">Nenhuma movimentação no período.</td></tr>}
                    {[...shown].sort((a, b) => b.lines.reduce((x, l) => x + l.billed, 0) - a.lines.reduce((x, l) => x + l.billed, 0)).map((g) => {
                      const gb = g.lines.reduce((a, l) => a + l.billed, 0), gm = g.lines.reduce((a, l) => a + l.margin, 0), gc = g.lines.reduce((a, l) => a + cost(l), 0);
                      const gComp = g.lines.reduce((a, l) => a + (l.monthPct != null && l.margin ? l.margin / (l.monthPct / 100) : 0), 0);
                      const isOpen = !closed.has(g.key);
                      const tog = () => setClosed((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; });
                      return (
                        <Fragment key={g.key}>
                          <tr className="cursor-pointer border-t bg-muted/40 hover:bg-muted/70" onClick={() => setDetail({ line: g.lines[0]!, client: true })}>
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-1.5">
                                <button type="button" aria-label={isOpen ? "Recolher" : "Abrir"} onClick={(e) => { e.stopPropagation(); tog(); }} className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground">
                                  <ChevronDown className={cn("h-3 w-3 transition-transform", !isOpen && "-rotate-90")} />
                                </button>
                                <span className="truncate font-display font-semibold uppercase tracking-wide">{g.name}</span>
                                <span className="text-[11px] text-muted-foreground">{g.lines.length} {g.lines.length === 1 ? "serviço" : "serviços"}</span>
                              </span>
                            </td>
                            <td className="px-3 text-right font-semibold tabular-nums">{brl(gb)}</td>
                            <td className="px-3"><OrderBar o={ordersOf(g.lines, end)} /></td>
                            <td className="px-3 text-right tabular-nums text-muted-foreground">{brl(gc)}</td>
                            <td className="px-3"><CostBar lines={g.lines} total={gc} /></td>
                            <td className={cn("px-3 text-right font-semibold tabular-nums", gm < 0 && "text-destructive")}>{brl(gm)}</td>
                            <td className="px-3 text-center"><Chip pct={marginPercent(gm, gComp)} margin={gm} /></td>
                            <td /><td />
                          </tr>
                          {isOpen && g.lines.map((l) => (
                            <tr key={l.work.id} className="cursor-pointer border-t border-border/40 text-[13px] hover:bg-muted/30" onClick={() => setDetail({ line: l, client: false })}>
                              <td className="truncate py-1.5 pl-9 pr-3 text-muted-foreground hover:text-foreground" title={l.work.name}>{l.work.name}</td>
                              <td className="px-3 text-right tabular-nums">{brl(l.billed)}</td>
                              <td className="px-3"><OrderBar o={orderOf(l, end)} /></td>
                              <td className="px-3 text-right tabular-nums text-muted-foreground">{brl(cost(l))}</td>
                              <td className="px-3"><CostBar lines={[l]} total={cost(l)} /></td>
                              <td className={cn("px-3 text-right tabular-nums", l.margin < 0 && "text-destructive")}>{brl(l.margin)}</td>
                              <td className="px-3 text-center"><Chip pct={l.monthPct} margin={l.margin} /></td>
                              <td className="px-3"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="ov-widen h-full bg-foreground/70" style={{ width: `${Math.min(100, Math.max(0, l.progress))}%` }} /></div><span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(l.progress)}%</span></div></td>
                              <td className="px-3 text-right text-[12px] tabular-nums" title={`Margem acumulada: ${brl(l.total.margin)}`}><MarginPercent value={l.total.pct} margin={l.total.margin} /></td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="h-[96vh] w-[98vw] max-w-[98vw] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.line.work.clients?.name ?? detail?.line.work.client}{detail && !detail.client ? ` — ${detail.line.work.name}` : " — Geral"}</DialogTitle></DialogHeader>
          {detail && <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Carregando...</div>}><ResultadoPage key={`${detail.client ? "c" : "w"}:${detail.line.work.id}:${yms.join(",")}`} initialWorkId={detail.line.work.id} initialClientAll={detail.client} initialMonths={yms} /></Suspense>}
        </DialogContent>
      </Dialog>
    </FitScreen>
  );
}

/** Margem % em chip: na meta ou acima = cheio; abaixo = contorno; negativa/sem receita = vermelho. */
function Chip({ pct, margin }: { pct: number | null; margin: number }) {
  if (pct == null || margin < 0) return <MarginPercent value={pct} margin={margin} />;
  const ok = pct >= MARGIN_GOAL;
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums", ok ? "bg-foreground text-background" : "border border-border")}>{pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>;
}

/** Barra empilhada das despesas da linha (valor total ao lado; cada parte no mouse). */
function CostBar({ lines, total }: { lines: FinanceLine[]; total: number }) {
  const p = COST_PARTS.map((x) => [x.label, lines.reduce((a, l) => a + l[x.key], 0), x.cls] as const);
  return (
    <div className="flex items-center gap-2" title={p.map(([n, v]) => `${n}: ${brl(v)}`).join("\n")}>
      <div className="ov-widen flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-muted">{p.map(([n, v, c]) => <div key={n} className={cn("h-full", c)} style={{ width: `${total ? (v / total) * 100 : 0}%` }} />)}</div>
      <span className="w-9" />
    </div>
  );
}

/** Barra normais (claro) × extras (cheio), proporcional ao total de horas. */
function HourBar({ n, e, className, delay = 0 }: { n: number; e: number; className?: string; delay?: number }) {
  const t = n + e || 1;
  return (
    <div className={cn("flex overflow-hidden rounded-full bg-muted", className)} title={`Normais ${hrs(n)} · Extras ${hrs(e)}`}>
      <div className="ov-widen h-full bg-foreground/25" style={{ width: `${(n / t) * 100}%`, animationDelay: `${delay}ms` }} />
      <div className="ov-widen h-full bg-foreground" style={{ width: `${(e / t) * 100}%`, animationDelay: `${delay + 120}ms` }} />
    </div>
  );
}

/** Andamento do pedido: barra do quanto já foi faturado (sem pedido = —). */
function OrderBar({ o }: { o: { ordered: number; billed: number } }) {
  if (!o.ordered) return <span className="text-[11px] text-muted-foreground">sem pedido</span>;
  const f = o.billed / o.ordered;
  return (
    <div className="flex items-center gap-2" title={`${brl(o.billed)} faturados de ${brl(o.ordered)} em pedidos`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="ov-widen h-full bg-foreground/70" style={{ width: `${Math.min(100, f * 100)}%` }} /></div>
      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(f * 100)}%</span>
    </div>
  );
}

/** Faixas do medidor da margem (tons de cinza, da pior para a melhor). */
const GAUGE_MAX = 50;
const GAUGE_BANDS = [
  { from: 0, to: 10, label: "Crítica · < 10%", cls: "bg-foreground/20", stroke: "stroke-foreground/20" },
  { from: 10, to: MARGIN_GOAL, label: `Abaixo · 10–${MARGIN_GOAL}%`, cls: "bg-foreground/45", stroke: "stroke-foreground/45" },
  { from: MARGIN_GOAL, to: 35, label: `Na meta · ${MARGIN_GOAL}–35%`, cls: "bg-foreground/75", stroke: "stroke-foreground/75" },
  { from: 35, to: GAUGE_MAX, label: "Ótima · > 35%", cls: "bg-foreground", stroke: "stroke-foreground" },
];
/** Medidor de ponteiro moderno (gauge do Excel repaginado): faixas arredondadas com respiro, agulha fina e valor no centro. */
function BandGauge({ pct }: { pct: number | null }) {
  const cx = 80, cy = 78, r = 60;
  const pt = (v: number, rr: number) => { const a = Math.PI * (1 - Math.max(0, Math.min(GAUGE_MAX, v)) / GAUGE_MAX); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const; };
  const arc = (a: number, b: number) => { const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r); return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`; };
  const v = pct ?? 0;
  const ang = -90 + (Math.max(0, Math.min(GAUGE_MAX, v)) / GAUGE_MAX) * 180;
  return (
    <div className="relative">
      <svg viewBox="0 0 160 92" className="h-[8.75rem] w-auto overflow-visible">
        {GAUGE_BANDS.map((b, i) => <path key={b.label} d={arc(b.from + 1.6, b.to - 1.6)} pathLength={1} fill="none" strokeWidth="11" strokeLinecap="round" className={cn("ov-draw", b.stroke)} style={{ animationDelay: `${i * 140}ms` }} />)}
        {Array.from({ length: 26 }, (_, i) => i * 2).map((t) => { const [x1, y1] = pt(t, r - 11), [x2, y2] = pt(t, r - (t % 10 ? 14 : 17)); return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-foreground/30" strokeWidth={t % 10 ? 0.6 : 1} />; })}
        {[0, 10, MARGIN_GOAL, 35, GAUGE_MAX].map((t) => { const [x, y] = pt(t, r + 12); return <text key={t} x={x} y={y + 2} textAnchor="middle" className="fill-muted-foreground text-[6.5px]">{t}%</text>; })}
        <g className="gauge-needle" style={{ transform: `rotate(${ang}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 6} className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r="5.5" className="fill-background stroke-foreground" strokeWidth="2" />
      </svg>
    </div>
  );
}

import { Fragment, Suspense, lazy, useEffect, useId, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/use-access";
import { useWorkScope } from "@/hooks/use-work-scope";
import { FitScreen } from "@/components/overview/fit-screen";
import { Donut, OverviewCard, StackBar } from "@/components/overview/charts";
import { CountUp } from "@/components/count-up";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { MultiFilter } from "@/components/multi-filter";
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
  const works = useQuery({ queryKey: ["fin-works"], queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [] });
  const holidays = useQuery({ queryKey: ["holidays-dates"], queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string) });
  const active = useQuery({ queryKey: ["fin-active", start, end], placeholderData: keepPreviousData, queryFn: () => loadFinanceActive(start, end) });
  const scope = useWorkScope();
  const list = useMemo(() => financeList(works.data ?? [], active.data, start, end).filter((w: any) => scope.allowWork(w)), [works.data, active.data, start, end, scope.allowWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const batches = useMemo(() => financeBatches(list), [list]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey, end], staleTime: 60_000, placeholderData: keepPreviousData,
    enabled: !!shared.data && !!active.data,
    queryFn: () => loadFinanceRaws(batches, shared.data!, { until: end }),
  });
  const groups = useMemo(() => buildFinanceGroups(list, raws.data ?? EMPTY, yms, year, holidays.data ?? [], works.data ?? []), [list, raws.data, yms, year, holidays.data, works.data]);
  const shown = useMemo(() => groups.filter((g) => !hidden.includes(g.key)), [groups, hidden]);

  const d = useMemo(() => {
    const lines = shown.flatMap((g) => g.lines);
    const s = (f: (l: FinanceLine) => number) => lines.reduce((a, l) => a + f(l), 0);
    const billed = s((l) => l.billed), tax = s((l) => l.tax), mo = s((l) => l.mo), transport = s((l) => l.transport), materials = s((l) => l.materials), margin = s((l) => l.margin);
    // Pedidos até o fim do período (sem data = sempre) × faturado até essa data, por serviço exibido.
    let ordered = 0, billedToDate = 0;
    for (const l of lines) {
      const os = Array.isArray(l.work.orders) ? (l.work.orders as { value?: unknown; date?: unknown }[]) : [];
      const o = os.length ? os.reduce((a, x) => a + (!x?.date || String(x.date).slice(0, 10) <= end ? Number(x?.value) || 0 : 0), 0) : Number(l.work.order_value ?? 0);
      if (o <= 0) continue;
      const b = (l.raw.entries as any[]).reduce((a, e) => a + (e.category === "faturamento" && String(e.entry_date).slice(0, 10) <= end ? Number(e.amount) || 0 : 0), 0);
      ordered += o; billedToDate += Math.min(o, b);
    }
    const hN = s((l) => l.hours.normal), hE = s((l) => l.hours.extra);
    const heByClient = shown.map((g) => ({ name: g.name, n: g.lines.reduce((a, l) => a + l.hours.normal, 0), e: g.lines.reduce((a, l) => a + l.hours.extra, 0) }))
      .filter((x) => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 3);
    const comp = lines.reduce((a, l) => a + (l.monthPct != null && l.margin ? l.margin / (l.monthPct / 100) : 0), 0);
    const pct = marginPercent(margin, comp);
    const below = lines.filter((l) => l.monthPct != null && l.monthPct < MARGIN_GOAL).length;
    return { lines, billed, tax, mo, transport, materials, margin, spent: tax + mo + transport + materials, ordered, billedToDate, open: ordered - billedToDate, hN, hE, heByClient, pct, below };
  }, [shown, end]);

  const toggle = (m: number) => setMonths((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));
  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - 3 + i));
  const loading = !scope.ready || works.isLoading || active.isLoading || shared.isLoading || (list.length > 0 && !raws.data);
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
              <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
                {MONTHS.map((m, i) => (
                  <button key={m} type="button" onClick={() => toggle(i + 1)}
                    className={cn("rounded-full px-2.5 py-1 transition-colors duration-300", months.includes(i + 1) ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{m}</button>
                ))}
                <button type="button" onClick={() => setMonths(months.length === 12 ? [] : MONTHS.map((_, i) => i + 1))} className="rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground">{months.length === 12 ? "Limpar" : "Ano todo"}</button>
              </div>
            </div>
            <MultiFilter title="Clientes" mode="show" hint="Marque os clientes considerados nos quadros e na tabela."
              options={groups.map((g) => ({ value: g.key, label: g.name }))}
              values={groups.filter((g) => !hidden.includes(g.key)).map((g) => g.key)}
              onChange={(vis) => saveHidden([...hidden.filter((k) => !groups.some((g) => g.key === k)), ...groups.filter((g) => !vis.includes(g.key)).map((g) => g.key)])} />
          </div>
        </div>

        {loading || !yms.length ? (yms.length ? <DashboardSkeleton /> : <p className="text-sm text-muted-foreground">Selecione ao menos um mês.</p>) : (
          <div className="grid gap-3 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:grid-rows-[13.25rem_minmax(0,1fr)]">
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

            <OverviewCard title="Margem de contribuição" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint={`Margem ÷ faturado por competência; meta ${MARGIN_GOAL}%. A seta enche até a margem (escala 0–50%).`} className="min-h-0" bodyClassName="flex min-h-0">
              <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <div className="space-y-1.5 self-center">
                  <p className={cn("font-display text-3xl font-semibold tabular-nums", (d.pct ?? 0) < 0 && "text-destructive")}>{d.pct == null ? "—" : <CountUp value={`${d.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} />}</p>
                  <p className="text-[11px] text-muted-foreground">{(d.pct ?? -1) >= MARGIN_GOAL ? "acima" : "abaixo"} da meta de {MARGIN_GOAL}%</p>
                  <p className="text-sm font-medium tabular-nums">{brlK(d.margin)}</p>
                  <p className="text-[11px] text-muted-foreground">{d.below} de {d.lines.length} serviços abaixo da meta</p>
                </div>
                <StepArrow pct={d.pct} goal={MARGIN_GOAL} />
              </div>
            </OverviewCard>

            <OverviewCard title="Pedidos faturados" to="/fechamentos/suzano" linkLabel="Abrir Pedidos" hint="Pedidos dos serviços exibidos com data até o fim do período × o que já foi faturado neles até essa data" className="min-h-0" bodyClassName="flex items-center">
              <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div><p className="font-display text-2xl font-semibold tabular-nums"><CountUp value={brlK(d.ordered)} /></p><p className="text-[11px] text-muted-foreground">em pedidos (todos, até o fim do período)</p></div>
                  <div className="flex gap-4">
                    <div><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.billedToDate)} /></p><p className="text-[11px] text-muted-foreground">faturado deles</p></div>
                    <div><p className="font-display text-lg font-semibold tabular-nums"><CountUp value={brlK(d.open)} /></p><p className="text-[11px] text-muted-foreground">em aberto</p></div>
                  </div>
                </div>
                <Donut frac={d.ordered ? d.billedToDate / d.ordered : 0} center={d.ordered ? `${Math.round((d.billedToDate / d.ordered) * 100)}%` : "—"} sub="faturado" size="h-32 w-32" />
              </div>
            </OverviewCard>

            <OverviewCard title="Horas normais × extras" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint="Horas de MO dos serviços exibidos: normais = até 8 h em dia útil; extras = acima disso, sábado, domingo e feriado" className="min-h-0">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                <Donut frac={d.hN + d.hE ? d.hE / (d.hN + d.hE) : 0} center={d.hN + d.hE ? `${Math.round((d.hE / (d.hN + d.hE)) * 100)}%` : "—"} sub="extras" size="h-24 w-24" />
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Normais</span><b className="tabular-nums">{hrs(d.hN)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Extras</span><b className="tabular-nums">{hrs(d.hE)}</b></div>
                  <p className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Mais HE</p>
                  {d.heByClient.map((c) => (
                    <div key={c.name}>
                      <div className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="tabular-nums text-muted-foreground">{hrs(c.e)}</span></div>
                      <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="ov-widen h-full bg-foreground" style={{ width: `${(c.e / Math.max(1, c.n + c.e)) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </OverviewCard>

            {/* Resumo das obras: colunas com largura fixa, números alinhados à direita, cliente com subtotal (sempre aberto). */}
            <div className="ov-card flex min-h-0 flex-col rounded-2xl border bg-card md:col-span-2 xl:col-span-4">
              <div className="flex items-center justify-between px-5 pt-3 text-xs">
                <p className="font-medium text-muted-foreground">Resumo das obras · {shown.length} clientes · {d.lines.length} serviços</p>
                <p className="text-muted-foreground">Clique no cliente para o resultado geral, no serviço para o detalhe</p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col /><col className="w-[9.5rem]" /><col className="w-[9.5rem]" /><col className="w-[11rem]" /><col className="w-[9.5rem]" /><col className="w-[6.5rem]" /><col className="w-[9rem]" /><col className="w-[10rem]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">Cliente / serviço</th>
                      <th className="px-3 text-right font-medium">Faturado</th>
                      <th className="px-3 text-right font-medium">Despesas</th>
                      <th className="px-3 text-left font-medium">Composição</th>
                      <th className="px-3 text-right font-medium">Margem</th>
                      <th className="px-3 text-center font-medium">Margem %</th>
                      <th className="px-3 text-left font-medium">Andamento</th>
                      <th className="px-3 text-right font-medium">Margem acumulada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!shown.length && <tr><td colSpan={8} className="px-3 py-4 text-muted-foreground">Nenhuma movimentação no período.</td></tr>}
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
                              <td className="px-3 text-right tabular-nums text-muted-foreground">{brl(cost(l))}</td>
                              <td className="px-3"><CostBar lines={[l]} total={cost(l)} /></td>
                              <td className={cn("px-3 text-right tabular-nums", l.margin < 0 && "text-destructive")}>{brl(l.margin)}</td>
                              <td className="px-3 text-center"><Chip pct={l.monthPct} margin={l.margin} /></td>
                              <td className="px-3"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground/70" style={{ width: `${Math.min(100, Math.max(0, l.progress))}%` }} /></div><span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(l.progress)}%</span></div></td>
                              <td className="px-3 text-right text-[12px] tabular-nums"><span className={cn(l.total.margin < 0 && "text-destructive")}>{brlK(l.total.margin)}</span> <span className="text-muted-foreground">· <MarginPercent value={l.total.pct} margin={l.total.margin} /></span></td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  {shown.length > 0 && (
                    <tfoot className="font-semibold">
                      <tr>
                        <td className="sticky bottom-0 border-t bg-card px-3 py-2">Total</td>
                        <td className="sticky bottom-0 border-t bg-card px-3 text-right tabular-nums">{brl(d.billed)}</td>
                        <td className="sticky bottom-0 border-t bg-card px-3 text-right tabular-nums">{brl(d.spent)}</td>
                        <td className="sticky bottom-0 border-t bg-card px-3"><CostBar lines={d.lines} total={d.spent} /></td>
                        <td className={cn("sticky bottom-0 border-t bg-card px-3 text-right tabular-nums", d.margin < 0 && "text-destructive")}>{brl(d.margin)}</td>
                        <td className="sticky bottom-0 border-t bg-card px-3 text-center"><Chip pct={d.pct} margin={d.margin} /></td>
                        <td className="sticky bottom-0 border-t bg-card" /><td className="sticky bottom-0 border-t bg-card" />
                      </tr>
                    </tfoot>
                  )}
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
  const p = [
    ["Impostos", lines.reduce((a, l) => a + l.tax, 0), "bg-foreground/25"],
    ["Mão de obra", lines.reduce((a, l) => a + l.mo, 0), "bg-foreground"],
    ["Transporte", lines.reduce((a, l) => a + l.transport, 0), "bg-foreground/60"],
    ["Materiais", lines.reduce((a, l) => a + l.materials, 0), "bg-foreground/40"],
  ] as const;
  return (
    <div className="flex items-center gap-2" title={p.map(([n, v]) => `${n}: ${brl(v)}`).join("\n")}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">{p.map(([n, v, c]) => <div key={n} className={cn("h-full", c)} style={{ width: `${total ? (v / total) * 100 : 0}%` }} />)}</div>
    </div>
  );
}

/** Seta "stonks" subindo em degraus; o preenchimento sobe até a margem (escala 0–50%), com traço na meta. */
function StepArrow({ pct, goal, max = 50 }: { pct: number | null; goal: number; max?: number }) {
  const id = useId().replace(/:/g, "");
  const f = Math.max(0, Math.min(1, (pct ?? 0) / max));
  // Degraus de baixo-esquerda até a ponta em cima-direita.
  const path = "M4 116 L4 98 L24 98 L24 78 L44 78 L44 58 L64 58 L64 38 L74 38 L74 26 L62 26 L84 4 L106 26 L94 26 L94 38 L94 116 Z";
  const top = 4, bottom = 116, h = bottom - top;
  const y = bottom - f * h, gy = bottom - Math.min(1, goal / max) * h;
  return (
    <svg viewBox="0 0 112 120" className="h-[9.5rem] w-auto overflow-visible">
      <defs><clipPath id={`a${id}`}><path d={path} /></clipPath></defs>
      <path d={path} className="fill-muted stroke-border" strokeWidth="1" />
      <g clipPath={`url(#a${id})`}>
        <rect x="0" width="112" y={y} height={bottom - y} className={cn("ov-rise", (pct ?? 0) < 0 ? "fill-destructive/70" : "fill-foreground")} style={{ transformOrigin: "50% 100%" }} />
      </g>
      <line x1="0" x2="112" y1={gy} y2={gy} className="stroke-foreground/60" strokeWidth="1" strokeDasharray="3 2" />
      <text x="110" y={gy - 2} textAnchor="end" className="fill-muted-foreground text-[7px]">meta {goal}%</text>
    </svg>
  );
}

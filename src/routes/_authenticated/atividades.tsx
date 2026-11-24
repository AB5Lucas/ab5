import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { useWorkScope } from "@/hooks/use-work-scope";
import { loadResultShared, monthEnd } from "@/lib/results-engine";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { directorSummary, MARGIN_GOAL, rdoCoverage } from "@/lib/director-overview";
import { BilledVsCost, Big, MarginGauge, MarginMonths, MiniBars, OverviewCard, StackBar } from "@/components/overview/charts";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/atividades")({
  head: () => ({ meta: [{ title: "Atividades | AB5 Hub" }] }),
  component: AtividadesOverview,
});

type Period = "mes" | "anterior" | "ano";
const PERIODS: [Period, string][] = [["mes", "Mês atual"], ["anterior", "Mês anterior"], ["ano", "Este ano"]];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct1 = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const addMonths = (ym: string, n: number) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return ymOf(d); };
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;
const isInternal = (name: string | null | undefined) => /^(ADM|COMERCIAL|P[AÁ]TIO|IND[UÚ]STRIA)$/i.test((name ?? "").trim());
const orderTotal = (w: any) => {
  const list = Array.isArray(w.orders) ? (w.orders as { value?: unknown }[]) : [];
  return list.reduce((a, o) => a + (Number(o?.value) || 0), 0) || Number(w.order_value ?? 0);
};

/** Visão da diretoria para o módulo Atividades: resultado, margem, clientes, serviços e operação (RDO e equipe). */
function AtividadesOverview() {
  const { canAccess } = useAccess();
  const scope = useWorkScope();
  const [period, setPeriod] = useState<Period>("mes");
  const today = new Date();
  const curYm = ymOf(today);
  // Meses do filtro e janela do gráfico (mês único mostra os 6 meses até ele, como contexto).
  const sel = useMemo(() => {
    if (period === "ano") { const out: string[] = []; for (let m = 1; m <= today.getMonth() + 1; m++) out.push(`${today.getFullYear()}-${String(m).padStart(2, "0")}`); return out; }
    return [period === "mes" ? curYm : addMonths(curYm, -1)];
  }, [period, curYm]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartYms = useMemo(() => (sel.length > 1 ? sel : Array.from({ length: 6 }, (_, i) => addMonths(sel[0]!, i - 5))), [sel]);
  const start = `${chartYms[0]}-01`;
  const end = monthEnd(sel[sel.length - 1]!);
  const selStart = `${sel[0]}-01`;
  const todayIso = today.toISOString().slice(0, 10);
  const opEnd = end < todayIso ? end : todayIso;

  const works = useQuery({ queryKey: ["fin-works"], queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [] });
  const holidays = useQuery({ queryKey: ["holidays-dates"], queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string) });
  const active = useQuery({ queryKey: ["fin-active", start, end], queryFn: () => loadFinanceActive(start, end) });
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const list = useMemo(() => financeList(works.data ?? [], active.data, start, end).filter((w: any) => scope.allowWork(w)), [works.data, active.data, start, end, scope.allowWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => financeBatches(list), [list]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey, end], staleTime: 60_000,
    enabled: !!shared.data && !!active.data && canAccess("/obras/resultado"),
    queryFn: () => loadFinanceRaws(batches, shared.data!, { until: end }),
  });
  const chart = useMemo(() => (raws.data ? directorSummary(list, raws.data, chartYms, holidays.data ?? [], works.data ?? []) : null), [raws.data, list, chartYms, holidays.data, works.data]);
  const fin = useMemo(() => (raws.data ? directorSummary(list, raws.data, sel, holidays.data ?? [], works.data ?? []) : null), [raws.data, list, sel, holidays.data, works.data]);

  // Operação: serviços com MO escalada × RDO (qualquer situação) e equipe por dia, no período até hoje.
  const ops = useQuery({
    queryKey: ["overview", "ops", selStart, opEnd],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const sch = await fetchAll<any>((a, b) => supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", selStart).lte("schedule_date", opEnd).order("id").range(a, b));
      const dateOf = new Map(sch.map((s) => [s.id, String(s.schedule_date)]));
      const ids = [...dateOf.keys()];
      const allocs: any[] = [];
      for (let i = 0; i < ids.length; i += 60) allocs.push(...await fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id, collaborator_id, schedule_id").in("schedule_id", ids.slice(i, i + 60)).order("id").range(a, b)));
      const rdos = await fetchAll<any>((a, b) => supabase.from("rdos").select("work_id, report_date").gte("report_date", selStart).lte("report_date", opEnd).order("id").range(a, b));
      const billing = await fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id, amount").eq("category", "faturamento").eq("sync_cancelled", false).order("id").range(a, b));
      return { allocs: allocs.map((a) => ({ work_id: a.work_id, collaborator_id: a.collaborator_id, date: dateOf.get(a.schedule_id)! })), rdos, billing };
    },
  });
  const op = useMemo(() => {
    if (!ops.data || !works.data || !scope.ready) return null;
    const wc = new Map((works.data as any[]).map((w) => [w.id, { client_id: w.client_id, general: !!w.rdo_general, internal: isInternal(w.clients?.name) }]));
    const allowed = new Set((works.data as any[]).filter((w) => scope.allowWork(w)).map((w) => w.id));
    const cov = rdoCoverage(ops.data.allocs.filter((a) => allowed.has(a.work_id)), ops.data.rdos, wc);
    const activeWorks = (works.data as any[]).filter((w) => allowed.has(w.id) && w.active && !["cancelled", "completed"].includes(w.status) && !isInternal(w.clients?.name));
    const billedBy = new Map<string, number>();
    for (const e of ops.data.billing) billedBy.set(e.work_id, (billedBy.get(e.work_id) ?? 0) + Number(e.amount ?? 0));
    let ordered = 0, billed = 0;
    for (const w of activeWorks) { const o = orderTotal(w); if (o > 0) { ordered += o; billed += Math.min(o, billedBy.get(w.id) ?? 0); } }
    const byClient = new Map<string, number>();
    for (const w of activeWorks) { const n = w.clients?.name ?? "—"; byClient.set(n, (byClient.get(n) ?? 0) + 1); }
    const workName = new Map((works.data as any[]).map((w) => [w.id, `${w.clients?.name ?? ""} · ${w.name}`]));
    const lastDay = [...cov.byDay.keys()].sort().pop();
    return {
      cov, lastDay, missingLast: cov.missing.filter((m) => m.date === lastDay).map((m) => ({ id: m.work_id, name: workName.get(m.work_id) ?? "—" })),
      activeCount: activeWorks.length, clients: [...byClient.entries()].sort((a, b) => b[1] - a[1]),
      backlog: Math.max(0, ordered - billed), ordered, billedPct: ordered ? (billed / ordered) * 100 : null,
    };
  }, [ops.data, works.data, scope.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = (u: string) => canAccess(u);
  const finLoading = can("/obras/resultado") && (!fin || !chart);
  const periodLabel = period === "ano" ? `${today.getFullYear()} até ${monthName(curYm)}` : `${monthName(sel[0]!)}/${sel[0]!.slice(0, 4)}`;
  const t = fin?.totals;
  const prevMonth = chart && sel.length === 1 ? chart.months[chart.months.length - 2] : null;
  const delta = (a: number, b: number | undefined) => (b ? ((a - b) / b) * 100 : null);
  const goodMargin = (p: number | null) => (p ?? -1) >= MARGIN_GOAL;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Atividades <span className="text-primary">·</span> visão da diretoria</h1>
          <p className="text-sm text-muted-foreground">Resultado, margem, clientes e operação — {periodLabel}. Clique em um quadro para abrir os dados.</p>
        </div>
        <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={cn("rounded-full px-3 py-1 transition-colors duration-300", period === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {can("/obras/resultado") && (
        finLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
        ) : t && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <OverviewCard dark title="Faturamento" to="/fechamentos/financeiro" linkLabel="Abrir Fechamento" hint="Notas lançadas nos serviços no período (data da nota)">
                <Big dark value={brl(t.billed)} delta={prevMonth ? delta(t.billed, prevMonth.billed) : null} />
                <p className="text-[11px] text-background/60">{prevMonth ? `vs. ${monthName(prevMonth.ym)}: ${brl(prevMonth.billed)}` : `${sel.length} meses`}</p>
                <div className="mt-2"><MiniBars dark values={chart!.months.map((m) => m.billed)} /></div>
              </OverviewCard>
              <OverviewCard title="Margem de contribuição" to="/fechamentos/financeiro" linkLabel="Ver por serviço" hint="Faturado por competência menos 18,5% de impostos e os custos (mão de obra, transporte, materiais)">
                <Big value={brl(t.margin)} />
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className={cn("rounded-full px-2 py-0.5 font-semibold", goodMargin(t.pct) ? "bg-success/15 text-success" : "bg-primary/10 text-primary")}>{pct1(t.pct)}</span>
                  <span className="text-muted-foreground">meta {MARGIN_GOAL}% · {goodMargin(t.pct) ? "acima da meta" : "abaixo da meta"}</span>
                </div>
              </OverviewCard>
              <OverviewCard title="Custos do período" to="/fechamentos/financeiro" linkLabel="Ver detalhamento" hint="Mão de obra (com encargos), transporte e materiais/ferramentas/andaimes, mais impostos de 18,5%">
                <Big value={brl(t.mo + t.transport + t.materials)} />
                <div className="mt-2"><StackBar format={brl} parts={[
                  { label: "Mão de obra", value: t.mo, className: "bg-foreground" },
                  { label: "Transporte", value: t.transport, className: "bg-primary" },
                  { label: "Materiais", value: t.materials, className: "bg-muted-foreground/50" },
                ]} /></div>
              </OverviewCard>
              <OverviewCard title="Carteira a faturar" to="/obras/resultado" linkLabel="Ver andamento" hint="Pedidos dos serviços ativos ainda não faturados">
                <Big value={op ? brl(op.backlog) : "…"} />
                {op && <>
                  <p className="text-xs text-muted-foreground">de {brl(op.ordered)} em pedidos ativos</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="ov-widen h-full rounded-full bg-primary" style={{ width: `${op.billedPct ?? 0}%` }} /></div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{pct1(op.billedPct)} já faturado</p>
                </>}
              </OverviewCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <OverviewCard className="lg:col-span-2" title={sel.length > 1 ? "Margem por mês" : `Margem de ${monthName(sel[0]!)}`} to="/fechamentos/financeiro" linkLabel="Abrir Fechamento"
                hint={`Meta da empresa: ${MARGIN_GOAL}%. Verde = acima da meta.`}>
                {sel.length > 1
                  ? <MarginMonths goal={MARGIN_GOAL} data={fin!.months.map((m) => ({ label: monthName(m.ym), pct: m.pct, tip: `${monthName(m.ym)}/${m.ym.slice(2, 4)}`, extra: `${brl(m.margin)} de ${brl(m.comp)}` }))} />
                  : <MarginGauge pct={t.pct} goal={MARGIN_GOAL} label={`${brl(t.margin)} sobre ${brl(t.comp)} faturados`} />}
              </OverviewCard>
              <OverviewCard className="lg:col-span-3" title={`Faturado × custos — ${sel.length > 1 ? "meses do ano" : "últimos 6 meses"}`} to="/fechamentos/financeiro" linkLabel="Abrir Fechamento">
                <BilledVsCost format={brl} data={chart!.months.map((m) => ({ label: monthName(m.ym), billed: m.billed, cost: m.mo + m.transport + m.materials, marginPct: m.pct, tip: `${monthName(m.ym)}/${m.ym.slice(2, 4)}` }))} />
              </OverviewCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <OverviewCard title="Clientes — faturado e margem" to="/fechamentos/financeiro" linkLabel="Ver todos os clientes">
                <div className="space-y-2">
                  {fin!.clients.slice(0, 6).map((c, i) => {
                    const max = fin!.clients[0]?.comp || 1;
                    return (
                      <div key={c.name} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="flex items-center gap-2 tabular-nums">
                            <span className="text-muted-foreground">{brl(c.comp)}</span>
                            <span className={cn("w-14 rounded-full px-1.5 text-center text-[10px] font-semibold", goodMargin(c.pct) ? "bg-success/15 text-success" : "bg-primary/10 text-primary")}>{pct1(c.pct)}</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="ov-widen h-full rounded-full bg-foreground/80" style={{ width: `${(c.comp / max) * 100}%`, animationDelay: `${i * 60}ms` }} /></div>
                      </div>
                    );
                  })}
                  {!fin!.clients.length && <p className="py-6 text-center text-xs text-muted-foreground">Sem faturamento no período.</p>}
                </div>
              </OverviewCard>
              <div className="ov-card rounded-2xl border bg-card p-4">
                <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-primary" /><p className="text-xs font-medium text-muted-foreground">Serviços abaixo da meta de {MARGIN_GOAL}%</p></div>
                <div className="mt-3 divide-y">
                  {fin!.worst.map((w) => (
                    <Link key={w.id} to="/obras/resultado" search={{ work: w.id } as never} className="group flex items-center gap-3 py-2 text-xs">
                      <div className="min-w-0 flex-1"><p className="truncate font-medium group-hover:underline">{w.name}</p><p className="truncate text-muted-foreground">{w.client}</p></div>
                      <span className="tabular-nums text-muted-foreground">{brl(w.margin)}</span>
                      <span className="w-14 rounded-full bg-primary/10 px-1.5 text-center text-[10px] font-semibold text-primary">{w.pct == null ? "sem fat." : pct1(w.pct)}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:rotate-45" />
                    </Link>
                  ))}
                  {!fin!.worst.length && <p className="py-6 text-center text-xs text-success">Todos os serviços estão na meta. 👏</p>}
                </div>
              </div>
            </div>
          </>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {can("/externo/relatorio-diario") && (
          <OverviewCard className="lg:col-span-2" title="RDO dos serviços com equipe escalada" to="/externo/relatorio-diario" linkLabel="Abrir Relatório Diário"
            hint="Para cada dia, serviços (fora ADM/Comercial/Pátio/Indústria) com mão de obra escalada e se já existe RDO (rascunho ou finalizado); RDO Geral cobre o cliente">
            {!op ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : (
              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <div>
                  <p className="font-display text-3xl font-semibold tabular-nums"><CountUp value={pct1(op.cov.pct)} /></p>
                  <p className="text-xs text-muted-foreground">{op.cov.done} de {op.cov.expected} serviço-dias com RDO</p>
                  {op.missingLast.length > 0 && (
                    <div className="mt-3 text-[11px]">
                      <p className="font-medium text-primary">Sem RDO em {op.lastDay?.slice(8, 10)}/{op.lastDay?.slice(5, 7)}:</p>
                      {op.missingLast.slice(0, 4).map((m) => <p key={m.id} className="truncate text-muted-foreground">• {m.name}</p>)}
                      {op.missingLast.length > 4 && <p className="text-muted-foreground">+ {op.missingLast.length - 4}</p>}
                    </div>
                  )}
                </div>
                <div className="flex h-36 items-end gap-[3px]">
                  {[...op.cov.byDay.entries()].sort().slice(-31).map(([d, v], i) => {
                    const p = v.expected ? v.done / v.expected : 0;
                    return (
                      <div key={d} className="group/day relative flex h-full flex-1 flex-col justify-end" title={`${d.slice(8, 10)}/${d.slice(5, 7)}: ${v.done} de ${v.expected}`}>
                        <div className="relative w-full overflow-hidden rounded-sm bg-muted" style={{ height: `${Math.max(12, Math.min(100, v.expected * 6))}%` }}>
                          <div className={cn("ov-grow absolute inset-x-0 bottom-0", p >= 1 ? "bg-foreground" : "bg-primary")} style={{ height: `${p * 100}%`, animationDelay: `${i * 15}ms` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </OverviewCard>
        )}
        {can("/obras") && (
          <OverviewCard title="Operação" to="/clientes" linkLabel="Ver clientes e serviços" hint="Serviços ativos (fora ADM/Comercial/Pátio/Indústria) e média de pessoas escaladas por dia no período">
            {!op ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="font-display text-3xl font-semibold tabular-nums"><CountUp value={op.activeCount} /></p><p className="text-[11px] text-muted-foreground">serviços ativos</p></div>
                  <div><p className="font-display text-3xl font-semibold tabular-nums"><CountUp value={Math.round(op.cov.headcount)} /></p><p className="text-[11px] text-muted-foreground">pessoas/dia em obra</p></div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {op.clients.slice(0, 5).map(([name, n], i) => (
                    <div key={name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 truncate">{name}</span>
                      <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="ov-widen h-full rounded-full bg-primary/80" style={{ width: `${(n / (op.clients[0]?.[1] || 1)) * 100}%`, animationDelay: `${i * 60}ms` }} /></div>
                      <span className="w-5 text-right tabular-nums text-muted-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </OverviewCard>
        )}
      </div>
    </div>
  );
}

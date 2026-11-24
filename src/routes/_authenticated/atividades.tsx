import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { useWorkScope } from "@/hooks/use-work-scope";
import { Big, Gauge, HatchBars, LineArea, MiniBars, OverviewCard, RankBars } from "@/components/overview/charts";
import { cn } from "@/lib/utils";
import { ClientsMap } from "@/components/overview/clients-map";
import { isInternalClient } from "@/lib/fleet-budget";

export const Route = createFileRoute("/_authenticated/atividades")({
  head: () => ({ meta: [{ title: "Atividades | AB5 Hub" }] }),
  component: AtividadesOverview,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const isoOf = (d: Date) => `${ymOf(d)}-${String(d.getDate()).padStart(2, "0")}`;
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;
const orderTotal = (w: any) => {
  const list = Array.isArray(w.orders) ? (w.orders as { value?: unknown }[]) : [];
  const s = list.reduce((a, o) => a + (Number(o?.value) || 0), 0);
  return s || Number(w.order_value ?? 0);
};

/** Visão geral do módulo Atividades: cada cartão resume uma página e leva até ela. */
function AtividadesOverview() {
  const { canAccess } = useAccess();
  const scope = useWorkScope();
  const [span, setSpan] = useState<6 | 12>(6);
  const today = new Date();
  const from12 = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const from30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);

  const q = useQuery({
    queryKey: ["overview", "atividades", isoOf(today)],
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [works, billing, rdos] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, status, active, order_value, orders, clients(name)").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("work_entries").select("work_id, entry_date, amount").eq("category", "faturamento").eq("sync_cancelled", false).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("rdos").select("work_id, report_date, status").gte("report_date", isoOf(from30)).order("id").range(a, b)),
      ]);
      return { works, billing, rdos };
    },
  });

  const mapQ = useQuery({ queryKey: ["clients-map"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("clients").select("id, name, city, lat, lon").not("lat", "is", null)).data ?? [] });

  const d = useMemo(() => {
    if (!q.data || !scope.ready) return null;
    const works = q.data.works.filter((w) => scope.allowWork(w));
    const workBy = new Map(works.map((w) => [w.id, w]));
    const billing = q.data.billing.filter((e) => workBy.has(e.work_id));
    const rdos = q.data.rdos.filter((r) => workBy.has(r.work_id));
    // Faturado por mês (12 meses)
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) months.push(ymOf(new Date(today.getFullYear(), today.getMonth() - i, 1)));
    const byMonth = new Map(months.map((m) => [m, 0]));
    for (const e of billing) { const m = String(e.entry_date).slice(0, 7); if (byMonth.has(m)) byMonth.set(m, byMonth.get(m)! + Number(e.amount ?? 0)); }
    const monthVals = months.map((m) => byMonth.get(m)!);
    const cur = monthVals[11]!, prev = monthVals[10]!;
    // Pedidos x faturado (serviços ativos)
    const active = works.filter((w) => w.active && w.status !== "cancelled" && w.status !== "completed");
    const billedBy = new Map<string, number>();
    for (const e of billing) billedBy.set(e.work_id, (billedBy.get(e.work_id) ?? 0) + Number(e.amount ?? 0));
    let ordered = 0, billedActive = 0;
    for (const w of active) { const o = orderTotal(w); if (o > 0) { ordered += o; billedActive += Math.min(o, billedBy.get(w.id) ?? 0); } }
    // Top clientes no mês
    const cm = ymOf(today);
    const byClient = new Map<string, number>();
    for (const e of billing) if (String(e.entry_date).startsWith(cm)) { const n = workBy.get(e.work_id)?.clients?.name ?? "—"; byClient.set(n, (byClient.get(n) ?? 0) + Number(e.amount ?? 0)); }
    const byClientId = new Map<string, number>();
    for (const e of billing) if (String(e.entry_date).startsWith(cm)) { const id = workBy.get(e.work_id)?.client_id; if (id) byClientId.set(id, (byClientId.get(id) ?? 0) + Number(e.amount ?? 0)); }
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));
    // RDOs por dia (30 dias)
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) days.push(isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
    const rdoDay = new Map(days.map((x) => [x, { fin: 0, all: 0 }]));
    for (const r of rdos) { const x = rdoDay.get(String(r.report_date).slice(0, 10)); if (x) { x.all++; if (r.status === "finalized") x.fin++; } }
    const todayR = rdoDay.get(isoOf(today))!;
    return {
      byClientId, months, monthVals, cur, prev, ordered, billedActive, top, days, rdoDay, todayR,
      activeCount: active.length, clientCount: new Set(active.map((w) => w.client_id)).size,
      openBalance: Math.max(0, ordered - billedActive),
      statusBars: ["planned", "active", "paused", "completed"].map((s) => works.filter((w) => w.status === s).length),
    };
  }, [q.data, scope.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mapa: clientes com endereço localizado (sem os internos da sede), marcador do tamanho do faturado no mês.
  const mapClients = useMemo(() => (mapQ.data ?? [])
    .filter((c: any) => scope.ready && scope.allowClient(c.id) && !isInternalClient(c.name ?? ""))
    .map((c: any) => ({ id: c.id, name: c.name, city: c.city, lat: Number(c.lat), lon: Number(c.lon), billed: d?.byClientId.get(c.id) ?? 0 })),
  [mapQ.data, scope.ready, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = (u: string) => canAccess(u);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const loading = !d;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Atividades</h1>
          <p className="text-sm text-muted-foreground">Visão geral de clientes, resultados e relatórios diários. Clique em um quadro para abrir a página.</p>
        </div>
        <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
          {([6, 12] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSpan(s)}
              className={cn("rounded-full px-3 py-1 transition-colors duration-300", span === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {s} meses
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {can("/obras/resultado") && (
              <OverviewCard dark title="Faturado no mês" to="/obras/resultado" linkLabel="Ver resultados" hint="Notas lançadas nos serviços no mês atual, comparadas ao mês anterior">
                <Big dark value={brl(d.cur)} delta={delta(d.cur, d.prev)} />
                <div className="mt-3"><MiniBars dark values={d.monthVals.slice(-span)} /></div>
              </OverviewCard>
            )}
            {can("/obras") && (
              <OverviewCard title="Serviços ativos" to="/obras" linkLabel="Ver serviços" hint="Serviços ativos (não concluídos nem cancelados) e clientes atendidos">
                <Big value={d.activeCount} />
                <p className="text-xs text-muted-foreground">em {d.clientCount} clientes</p>
                <div className="mt-2"><MiniBars values={d.statusBars} /></div>
              </OverviewCard>
            )}
            {can("/externo/relatorio-diario") && (
              <OverviewCard title="RDOs de hoje" to="/externo/relatorio-diario" linkLabel="Ver relatórios" hint="RDOs finalizados hoje sobre os criados hoje">
                <Big value={`${d.todayR.fin} de ${d.todayR.all}`} />
                <p className="text-xs text-muted-foreground">finalizados</p>
                <div className="mt-2"><MiniBars values={d.days.slice(-14).map((x) => d.rdoDay.get(x)!.fin)} /></div>
              </OverviewCard>
            )}
            {can("/obras/resultado") && (
              <OverviewCard title="Saldo a faturar" to="/obras/resultado" linkLabel="Ver resultados" hint="Soma dos pedidos dos serviços ativos menos o que já foi faturado neles">
                <Big value={brl(d.openBalance)} />
                <p className="text-xs text-muted-foreground">de {brl(d.ordered)} em pedidos</p>
              </OverviewCard>
            )}
          </div>

          {can("/obras/resultado") && (
            <div className="grid gap-4 lg:grid-cols-3">
              <OverviewCard dark title="Pedidos faturados" to="/obras/resultado" linkLabel="Ver andamento por serviço" hint="Quanto dos pedidos dos serviços ativos já foi faturado">
                <Gauge dark pct={d.ordered ? (d.billedActive / d.ordered) * 100 : 0} label="dos pedidos ativos" sub={`${brl(d.billedActive)} de ${brl(d.ordered)}`} />
              </OverviewCard>
              <OverviewCard className="lg:col-span-2" title={`Faturamento por mês — últimos ${span} meses`} to="/obras/resultado" linkLabel="Abrir Resultados">
                <HatchBars format={brl} data={d.months.slice(-span).map((m, i) => ({ label: monthLabel(m), value: d.monthVals.slice(-span)[i]!, tip: `${monthLabel(m)}/${m.slice(2, 4)}` }))} />
              </OverviewCard>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {can("/externo/relatorio-diario") && (
              <OverviewCard className="lg:col-span-2" title="RDOs nos últimos 30 dias" to="/externo/relatorio-diario" linkLabel="Abrir Relatório Diário" hint="Linha cheia = finalizados; tracejada = criados">
                <LineArea data={d.days.map((x) => ({ label: `${x.slice(8, 10)}/${x.slice(5, 7)}`, a: d.rdoDay.get(x)!.fin, b: d.rdoDay.get(x)!.all }))}
                  format={(p) => `${p.a} finalizados de ${p.b ?? 0}`} />
              </OverviewCard>
            )}
            {can("/obras") && (
              <OverviewCard title="Clientes que mais faturaram no mês" to="/clientes" linkLabel="Ver clientes">
                {d.top.length ? <RankBars rows={d.top} format={brl} /> : <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma nota lançada neste mês.</p>}
              </OverviewCard>
            )}
          </div>

          {can("/obras") && mapClients.length > 0 && (
            <OverviewCard title="Clientes no mapa" to="/clientes" linkLabel="Ver clientes" hint="Marcador do tamanho do faturado no mês; Expandir abre o Brasil">
              {/* Clicar/arrastar no mapa não abre a página (o quadro é um link). */}
              <div onClick={(e) => e.preventDefault()}><ClientsMap clients={mapClients} /></div>
            </OverviewCard>
          )}
        </>
      )}
    </div>
  );
}

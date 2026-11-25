import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { Big, Donut, HoverBars, OverviewCard } from "@/components/overview/charts";
import { PatioCalendar } from "@/components/overview/patio-calendar";
import { Pie3D } from "@/components/overview/pie-3d";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";

export const Route = createFileRoute("/_authenticated/planejamento")({
  pendingComponent: DashboardSkeleton,
  head: () => ({ meta: [{ title: "Planejamento | AB5 Hub" }, { name: "description", content: "Visão geral da programação: escalações, ausências, transporte e Pátio." }, { property: "og:title", content: "Planejamento | AB5 Hub" }, { property: "og:description", content: "Visão geral da programação: escalações, ausências, transporte e Pátio." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PlanejamentoOverview,
});

const STATIC = 5 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (iso: string, n: number) => isoOf(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000));
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

type Period = "hoje" | "amanha" | "semana" | "mes";
const PERIODS: { key: Period; label: string }[] = [
  { key: "hoje", label: "Hoje" }, { key: "amanha", label: "Amanhã" }, { key: "semana", label: "Esta semana" }, { key: "mes", label: "Mês atual" },
];
/** Período do filtro (dias de from a to) e o mês do calendário do Pátio. */
function rangeOf(p: Period, today: string) {
  if (p === "hoje") return { from: today, to: today };
  if (p === "amanha") { const t = addDays(today, 1); return { from: t, to: t }; }
  if (p === "semana") {
    const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // seg = 0
    const mon = addDays(today, -wd);
    return { from: mon, to: addDays(mon, 6) };
  }
  const ym = today.slice(0, 7);
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}
const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/** Visão geral do módulo Planejamento (layout montado pelo usuário no artefato, 25/11). */
function PlanejamentoOverview() {
  const { canAccess, loading } = useAccess();
  const nav = useNavigate();
  const allowed = canAccess("/programacao/diaria");
  useEffect(() => { if (!loading && !allowed) nav({ to: "/dashboard", replace: true }); }, [loading, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <DashboardSkeleton />;
  if (!allowed) return null;
  return <Overview />;
}

function Overview() {
  const today = todayIso();
  const [period, setPeriod] = useState<Period>("hoje");
  const nav = useNavigate();
  const R = rangeOf(period, today);
  const single = R.from === R.to;
  // Mês do calendário do Pátio e das barras: o mês do início do período.
  const ym = R.from.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const mFrom = `${ym}-01`, mTo = `${ym}-${pad(lastDay)}`;
  const qFrom = R.from < mFrom ? R.from : mFrom, qTo = R.to > mTo ? R.to : mTo;

  const worksQ = useQuery({ queryKey: ["overview", "plan-works"], staleTime: STATIC, queryFn: () => fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, status, active, clients(name)").order("id").range(a, b)) });
  const allocQ = useQuery({
    queryKey: ["overview", "plan-alloc", qFrom, qTo], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: () => fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id, collaborator_id, service_assigned, daily_schedules!inner(schedule_date)")
      .gte("daily_schedules.schedule_date", qFrom).lte("daily_schedules.schedule_date", qTo).order("id").range(a, b)),
  });
  const rangeQ = useQuery({
    queryKey: ["overview", "plan-range", R.from, R.to], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => {
      const [veh] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("id, schedule_date, vehicle_id, driver_id, client_id, km, is_maintenance, maintenance_kind, external_place, adm_place, is_suzano_local, vehicles(plate, model)").gte("schedule_date", R.from).lte("schedule_date", R.to).order("id").range(a, b)),
      ]);
      return { veh };
    },
  });
  // Mesma ordem dos veículos da aba Transporte (preferência salva por usuário).
  const vehOrderQ = useQuery({
    queryKey: ["vehicle-view-prefs"], staleTime: STATIC,
    queryFn: async () => {
      const { data } = await supabase.from("vehicle_view_prefs").select("hidden_vehicle_ids, vehicle_order").maybeSingle();
      return { hidden: (data?.hidden_vehicle_ids ?? []) as string[], order: (data?.vehicle_order ?? []) as string[] };
    },
  });
  // Frota inteira (para a pizza de veículos: em operação, manutenção, revisão, sem escala).
  const fleetQ = useQuery({
    queryKey: ["overview", "plan-fleet"], staleTime: STATIC,
    queryFn: async () => (await supabase.from("vehicles").select("id, plate, model, status").order("plate")).data ?? [],
  });
  const cadQ = useQuery({
    queryKey: ["overview", "plan-cad"], staleTime: STATIC,
    queryFn: async () => {
      const [cl, co] = await Promise.all([
        supabase.from("clients").select("id, name"),
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, status").order("id").range(a, b)),
      ]);
      return { clients: cl.data ?? [], collabs: co };
    },
  });

  const d = useMemo(() => {
    if (!worksQ.data || !allocQ.data || !rangeQ.data || !cadQ.data) return null;
    const work = new Map<string, any>(worksQ.data.map((w: any) => [w.id, w]));
    const clientOf = (wid: string | null) => (wid ? work.get(wid)?.clients?.name ?? "—" : "—");
    const clientName = new Map(cadQ.data.clients.map((c) => [c.id, c.name]));
    const person = new Map(cadQ.data.collabs.map((c: any) => [c.id, c.full_name as string]));
    const workforce = cadQ.data.collabs.filter((c: any) => c.status === "active").length;
    const dateOf = (a: any) => a.daily_schedules?.schedule_date as string;
    // Barras: dias do período (um dia só → o mês, para ter contexto).
    const barDays = single ? daysBetween(mFrom, mTo).filter((x) => x <= (R.from > today ? R.from : today)) : daysBetween(R.from, R.to);
    const ppl = new Map(daysBetween(qFrom, qTo).map((x) => [x, new Set<string>()]));
    const patio = new Map(daysBetween(mFrom, mTo).map((x) => [x, new Set<string>()]));
    const patioAll = new Set<string>();
    for (const a of allocQ.data) {
      const dt = dateOf(a);
      ppl.get(dt)?.add(a.collaborator_id);
      if (norm(clientOf(a.work_id)) === "PATIO" && patio.has(dt)) { patio.get(dt)!.add(a.collaborator_id); patioAll.add(a.collaborator_id); }
    }
    const series = barDays.map((x) => ({ label: brDay(x), value: ppl.get(x)?.size ?? 0, tip: `${brDay(x)}: ${ppl.get(x)?.size ?? 0} pessoas` }));
    const rangeDays = daysBetween(R.from, R.to);
    const withPpl = rangeDays.map((x) => ppl.get(x)?.size ?? 0).filter((v) => v > 0);
    const avg = withPpl.length ? Math.round(withPpl.reduce((a, v) => a + v, 0) / withPpl.length) : 0;
    const patioDays = daysBetween(mFrom, mTo).map((x) => ({ key: x, label: String(Number(x.slice(8, 10))), title: brDay(x), value: patio.get(x)!.size,
      names: [...patio.get(x)!].map((id) => person.get(id) ?? "—").sort((a, b) => a.localeCompare(b, "pt-BR")) }));
    // Escalações do período por cliente e serviço.
    type G = { clientId: string | null; people: Set<string>; pd: number; works: Map<string, Set<string>>; pend: Set<string>; days: Set<string> };
    const byClient = new Map<string, G>();
    const inRange = allocQ.data.filter((a: any) => dateOf(a) >= R.from && dateOf(a) <= R.to);
    for (const a of inRange) {
      const c = clientOf(a.work_id);
      const g = byClient.get(c) ?? { clientId: a.work_id ? work.get(a.work_id)?.client_id ?? null : null, people: new Set(), pd: 0, works: new Map(), pend: new Set(), days: new Set() };
      g.people.add(a.collaborator_id); g.pd++; g.days.add(dateOf(a));
      if (a.service_assigned) { const s = g.works.get(a.work_id) ?? new Set<string>(); s.add(a.collaborator_id); g.works.set(a.work_id, s); }
      else g.pend.add(a.collaborator_id);
      byClient.set(c, g);
    }
    const clients = [...byClient.entries()].map(([name, g]) => ({
      name, clientId: g.clientId, people: g.people.size, personDays: g.pd, days: g.days.size, pend: g.pend.size,
      works: [...g.works.entries()].map(([wid, s]) => ({ name: work.get(wid)?.name ?? "—", n: s.size })).sort((a, b) => b.n - a.n),
    })).sort((a, b) => b.people - a.people);
    const people = new Set(inRange.map((a: any) => a.collaborator_id)).size;
    const activeWorks = worksQ.data.filter((w: any) => w.active !== false && w.status !== "completed").length;
    // Transporte: um por veículo (no período: dias, km somado, cliente e motorista mais frequentes).
    const byVeh = new Map<string, { plate: string; model: string; days: Set<string>; maintDays: number; km: number; clients: Map<string, number>; drivers: Map<string, number> }>();
    for (const v of rangeQ.data.veh) {
      const maint = !!v.is_maintenance;
      const client = maint ? (v.maintenance_kind === "revisao" ? "REVISÃO" : "MANUTENÇÃO")
        : v.is_suzano_local ? "SUZANO LOCAL" : v.external_place ?? v.adm_place ?? (v.client_id ? clientName.get(v.client_id) ?? "—" : "—");
      const g = byVeh.get(v.vehicle_id) ?? { plate: v.vehicles?.plate ?? "—", model: v.vehicles?.model ?? "", days: new Set(), maintDays: 0, km: 0, clients: new Map(), drivers: new Map() };
      g.days.add(v.schedule_date); if (maint) g.maintDays++; else g.km += Number(v.km ?? 0);
      g.clients.set(client, (g.clients.get(client) ?? 0) + 1);
      const dn = v.driver_id ? (person.get(v.driver_id) ?? "").split(" ")[0]! : "a definir";
      g.drivers.set(dn, (g.drivers.get(dn) ?? 0) + 1);
      byVeh.set(v.vehicle_id, g);
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const rank = new Map((vehOrderQ.data?.order ?? []).map((id, i) => [id, i]));
    const vehicles = [...byVeh.entries()].map(([vid, g]) => {
      const cl = top(g.clients);
      const maint = g.maintDays === g.days.size;
      return { rank: rank.get(vid) ?? Number.MAX_SAFE_INTEGER, plate: g.plate, model: g.model, client: cl[0] ?? "—", more: cl.length - 1, maint, driver: top(g.drivers)[0] ?? "—", km: maint ? null : g.km, days: g.days.size };
    }).sort((a, b) => a.rank - b.rank || a.plate.localeCompare(b.plate, "pt-BR"));
    // Pizza de veículos: cada veículo ativo (fora os ocultos na Transporte) numa situação no período —
    // em operação (algum frete) > manutenção > revisão > sem escala.
    const hiddenVeh = new Set(vehOrderQ.data?.hidden ?? []);
    const vState = new Map<string, "op" | "man" | "rev">();
    for (const v of rangeQ.data.veh) {
      const k = !v.is_maintenance ? "op" : v.maintenance_kind === "revisao" ? "rev" : "man";
      const prev = vState.get(v.vehicle_id);
      if (!prev || (k === "op") || (k === "man" && prev === "rev")) vState.set(v.vehicle_id, k);
    }
    const fleetRows = (fleetQ.data ?? []).filter((v) => v.status !== "inactive" && !hiddenVeh.has(v.id));
    const vehLabel = (v: { plate: string | null; model: string | null }) => [v.plate, v.model].filter(Boolean).join(" · ");
    const VEH_PARTS: [string, string][] = [["op", "Em operação"], ["man", "Manutenção"], ["rev", "Revisão"], ["none", "Sem escala"]];
    const vehParts = VEH_PARTS.map(([key, label]) => {
      const list = fleetRows.filter((v) => (vState.get(v.id) ?? "none") === key)
        .sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9) || String(x.plate).localeCompare(String(y.plate)));
      return { key, label, n: list.length, names: list.map(vehLabel) };
    });
    const worksSet = new Set(inRange.filter((a: any) => a.service_assigned).map((a: any) => a.work_id));
    const worksByClient = clients.filter((c) => c.works.length).map((c) => ({ name: c.name, n: c.works.length }));
    return {
      series, avg, people, patioDays, patioCount: patioAll.size, workforce, clients, activeWorks, vehParts, fleetTotal: fleetRows.length, vehicles,
      kmTotal: vehicles.reduce((a, v) => a + (v.km ?? 0), 0), maint: vehicles.filter((v) => v.maint).length,
      worksCount: worksSet.size, worksByClient, pendTotal: clients.reduce((a, c) => a + c.pend, 0),
    };
  }, [worksQ.data, allocQ.data, rangeQ.data, cadQ.data, vehOrderQ.data, fleetQ.data, R.from, R.to, single, today, mFrom, mTo, qFrom, qTo]);

  const pLabel = period === "hoje" ? "hoje" : period === "amanha" ? "amanhã" : period === "semana" ? "esta semana" : "mês atual";
  const when = single ? brDay(R.from) : `${brDay(R.from)} a ${brDay(R.to)}`;
  const month = MONTHS[Number(ym.slice(5, 7)) - 1];
  const loadingNew = allocQ.isPlaceholderData || rangeQ.isPlaceholderData;
  return (
    <div className={cn("flex flex-col gap-3 transition-opacity duration-300 xl:h-[calc(100dvh-6.5rem)] xl:min-h-[640px]", loadingNew && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">Planejamento</h1>
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
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:grid-rows-[13.25rem_minmax(0,1fr)]">
            <OverviewCard dark title={single ? `Pessoas escaladas — ${pLabel}` : `Pessoas escaladas por dia — ${pLabel}`} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas alocadas nos clientes na Programação" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
              <Big dark value={single ? d.people : d.avg} />
              <p className="text-xs text-background/60">{single ? `${pLabel} · média do mês ${Math.round(d.series.filter((s) => s.value).reduce((a, s) => a + s.value, 0) / Math.max(1, d.series.filter((s) => s.value).length))}` : `média por dia · ${d.people} pessoas diferentes`}</p>
              <div className="mt-auto pt-2"><HoverBars dark data={d.series} format={(v) => `${v} pessoas`} height="h-16" /></div>
            </OverviewCard>
            <OverviewCard title={`Serviços com equipe — ${pLabel}`} to="/programacao/servicos" linkLabel="Abrir Serviços" hint="Serviços com gente distribuída no período, por cliente" className="min-h-0" bodyClassName="min-h-0 overflow-hidden">
              <div className="flex items-baseline gap-2"><Big value={d.worksCount} /><span className="text-xs text-muted-foreground">de {d.activeWorks} serviços ativos</span></div>
              <ClientBars rows={d.worksByClient} empty="Nenhum serviço com equipe." limit={4} />
            </OverviewCard>
            <OverviewCard title={`Transporte — ${pLabel}`} to="/veiculos/transporte" linkLabel="Abrir Transporte" hint="Veículos na escala da Transporte no período" className="min-h-0 xl:row-span-2" bodyClassName="flex min-h-0 flex-col">
              <div className="grid grid-cols-3 gap-2">
                {([[d.vehicles.length, "veículos"], [d.maint, "manutenção"], [d.kmTotal, "km de ida"]] as const).map(([v, l]) => (
                  <div key={l}><div className="font-display text-2xl font-semibold tabular-nums"><CountUp value={v} /></div><div className="text-[11px] text-muted-foreground">{l}</div></div>
                ))}
              </div>
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                {!d.vehicles.length && <p className="py-6 text-center text-xs text-muted-foreground">Sem escala de veículos no período.</p>}
                {d.vehicles.map((v, i) => (
                  <div key={`${v.plate}-${i}`} className="grid grid-cols-[4.2rem_minmax(0,1fr)_3.4rem] items-center gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
                    <span className="font-display text-[13px] font-semibold">{v.plate}</span>
                    <span className="min-w-0">
                      <span className={cn("block truncate", v.maint ? "italic text-muted-foreground" : "font-medium")}>{v.client}{v.more > 0 && <span className="font-normal text-muted-foreground"> +{v.more}</span>}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">{v.model} · {v.driver}{!single && ` · ${v.days} ${v.days === 1 ? "dia" : "dias"}`}</span>
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-muted-foreground">{v.km == null ? "—" : `${v.km} km`}</span>
                  </div>
                ))}
              </div>
            </OverviewCard>
            <OverviewCard title={`Sem serviço distribuído — ${pLabel}`} to="/programacao/servicos" linkLabel="Abrir Serviços" hint="Pessoas escaladas no cliente ainda sem serviço na aba Serviços, em relação a todos os escalados" className="min-h-0">
              {(() => {
                const pend = d.pendTotal, tot = d.people, dist = Math.max(0, tot - pend);
                const rows = d.clients.filter((c) => c.pend > 0).sort((x, y) => y.pend - x.pend);
                return (
                  <div className="grid grid-cols-2 items-center gap-3">
                    <div className="min-w-0">
                      <Big value={pend} />
                      <p className="text-xs text-muted-foreground">sem serviço de {tot} escalados</p>
                      <div className="mt-2 space-y-0.5 text-[11px]">
                        {!rows.length && <p className="text-muted-foreground">Todos distribuídos.</p>}
                        {rows.slice(0, 3).map((c) => (
                          <div key={c.name} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><b className="tabular-nums">{c.pend}</b></div>
                        ))}
                        {rows.length > 3 && <p className="text-[10px] text-muted-foreground">+{rows.length - 3} clientes</p>}
                      </div>
                    </div>
                    <Donut frac={tot ? dist / tot : 0} center={tot ? `${Math.round((dist / tot) * 100)}%` : "—"} sub="distribuído" size="h-36 w-36" />
                  </div>
                );
              })()}
            </OverviewCard>
            <OverviewCard dark title={`Pessoas no Pátio — ${month}`} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas escaladas no cliente Pátio no mês" className="min-h-0 md:col-span-2" bodyClassName="min-h-0 overflow-hidden">
              <div onClick={(e) => e.preventDefault()}><PatioCalendar dark big days={d.patioDays} unit="day" total={d.patioCount} workforce={d.workforce} /></div>
            </OverviewCard>
            <OverviewCard title={`Veículos — ${pLabel}`} to="/veiculos/transporte" linkLabel="Abrir Transporte" hint="Situação de cada veículo da frota no período (em operação, manutenção, revisão ou sem escala na Transporte). Clique numa fatia para ver os veículos." className="min-h-0 xl:col-start-4" bodyClassName="flex min-h-0 flex-col">
              <Pie3D total={d.fleetTotal} totalLabel="veículos na frota" parts={d.vehParts} unit={["veículo", "veículos"]} badge={(n) => n.split(" · ")[0]!.slice(0, 3)} />
            </OverviewCard>
          </div>
          <OverviewCard title={`Escalações — ${pLabel} · ${d.clients.length} clientes · ${d.worksCount} serviços · ${d.people} pessoas`} to="/programacao/servicos" linkLabel="Abrir Serviços"
            hint="Pessoas escaladas por cliente no período" className="shrink-0 xl:h-[13.25rem]" bodyClassName="min-h-0 overflow-hidden">
            {!d.clients.length ? <p className="py-10 text-center text-xs text-muted-foreground">Sem escalações no período.</p> : (
              <div className="grid h-full grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none xl:grid-rows-1 xl:overflow-hidden">
                {d.clients.slice(0, 8).map((c, i) => (
                  <ClientTile key={c.name} c={c} single={single} index={i}
                    onOpen={c.clientId ? () => void nav({ to: "/programacao/servicos", search: { client: c.clientId!, date: single ? R.from : today } }) : undefined} />
                ))}
              </div>
            )}
          </OverviewCard>
        </>
      )}
    </div>
  );
}

type ClientRow = { name: string; clientId: string | null; people: number; personDays: number; days: number; pend: number; works: { name: string; n: number }[] };
/** Quadro de um cliente na faixa de Escalações: pessoas, distribuição, serviços com quantas pessoas cada. */
function ClientTile({ c, single, onOpen, index = 0 }: { c: ClientRow; single: boolean; onOpen?: (() => void) | undefined; index?: number }) {
  return (
    <div role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} title={onOpen ? `Abrir ${c.name} na aba Serviços` : undefined}
      onClick={onOpen ? (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); } : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onOpen(); } } : undefined}
      style={{ animationDelay: `${150 + index * 90}ms` }}
      className={cn("tile-snap flex min-h-0 min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 transition-colors", onOpen && "cursor-pointer hover:border-foreground/40 hover:bg-muted")}>
      <span className="truncate text-[11px] font-semibold tracking-wide" title={c.name}>{c.name}</span>
      <span className="flex items-baseline gap-1">
        <span className="font-display text-3xl font-semibold leading-none tabular-nums"><CountUp value={c.people} /></span>
        <span className="text-[11px] text-muted-foreground">pessoas{!single && ` · ${c.personDays} diárias`}</span>
      </span>
      <span className="flex h-3.5 flex-wrap gap-[3px] overflow-hidden" aria-hidden="true">
        {Array.from({ length: Math.min(c.people, 30) }, (_, i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-[2px]", i < c.people - c.pend ? "bg-foreground" : "bg-foreground/25")} />)}
      </span>
      <span className="flex justify-between gap-1 text-[10.5px] text-muted-foreground">
        <span>{c.works.length} {c.works.length === 1 ? "serviço" : "serviços"}</span>
        <span className={cn("truncate", c.pend > 0 && "font-medium text-foreground")}>{c.pend ? `${c.pend} sem serviço` : "distribuído"}</span>
      </span>
    </div>
  );
}

function ClientBars({ rows, empty, limit, tight }: { rows: { name: string; n: number }[]; empty: string; limit: number; tight?: boolean }) {
  if (!rows.length) return <p className={cn("text-center text-xs text-muted-foreground", tight ? "py-1" : "py-4")}>{empty}</p>;
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...sorted.map((r) => r.n));
  return (
    <div className={tight ? "space-y-1" : "mt-2 space-y-1.5"}>
      {sorted.slice(0, limit).map((r) => (
        <div key={r.name} className="grid grid-cols-[6rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-[11px]" title={`${r.name}: ${r.n}`}>
          <span className="truncate">{r.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="ov-grow block h-full rounded-full bg-foreground" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums text-muted-foreground">{r.n}</span>
        </div>
      ))}
    </div>
  );
}


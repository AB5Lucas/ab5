import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { Big, Donut, HoverBars, OverviewCard } from "@/components/overview/charts";
import { PatioCalendar } from "@/components/overview/patio-calendar";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/planejamento")({
  head: () => ({ meta: [{ title: "Planejamento | AB5 Hub" }, { name: "description", content: "Visão geral da programação: escalações, ausências, transporte e Pátio." }] }),
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
const ABSENCE: Record<string, "folga" | "ferias" | "atestado" | "falta"> = {
  folga: "folga", ferias: "ferias", atestado: "atestado", medico: "atestado", afastado: "atestado", licenca: "atestado", falta: "falta",
};
const ABS_LABEL = { folga: "Folgas", ferias: "Férias", atestado: "Atestados", falta: "Faltas" } as const;

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
  if (loading || !allowed) return null;
  return <Overview />;
}

function Overview() {
  const today = todayIso();
  const [period, setPeriod] = useState<Period>("hoje");
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
      const [boxes, off, vac, veh] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("collaborator_id, box_key, daily_schedules!inner(schedule_date)").gte("daily_schedules.schedule_date", R.from).lte("daily_schedules.schedule_date", R.to).order("id").range(a, b)),
        supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", R.to).or(`end_date.gte.${R.from},and(end_date.is.null,date.gte.${R.from})`),
        supabase.from("vacations").select("collaborator_id, status").lte("start_date", R.to).gte("end_date", R.from),
        fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("id, schedule_date, vehicle_id, driver_id, client_id, km, is_maintenance, maintenance_kind, external_place, adm_place, is_suzano_local, vehicles(plate, model)").gte("schedule_date", R.from).lte("schedule_date", R.to).order("id").range(a, b)),
      ]);
      return { boxes, off: off.data ?? [], vac: (vac.data ?? []).filter((v) => !/cancel/i.test(v.status ?? "")), veh };
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
    const patioDays = daysBetween(mFrom, mTo).map((x) => ({ key: x, label: String(Number(x.slice(8, 10))), title: brDay(x), value: patio.get(x)!.size }));
    // Escalações do período por cliente e serviço.
    type G = { people: Set<string>; pd: number; works: Map<string, Set<string>>; pend: Set<string>; days: Set<string> };
    const byClient = new Map<string, G>();
    const inRange = allocQ.data.filter((a: any) => dateOf(a) >= R.from && dateOf(a) <= R.to);
    for (const a of inRange) {
      const c = clientOf(a.work_id);
      const g = byClient.get(c) ?? { people: new Set(), pd: 0, works: new Map(), pend: new Set(), days: new Set() };
      g.people.add(a.collaborator_id); g.pd++; g.days.add(dateOf(a));
      if (a.service_assigned) { const s = g.works.get(a.work_id) ?? new Set<string>(); s.add(a.collaborator_id); g.works.set(a.work_id, s); }
      else g.pend.add(a.collaborator_id);
      byClient.set(c, g);
    }
    const clients = [...byClient.entries()].map(([name, g]) => ({
      name, people: g.people.size, personDays: g.pd, days: g.days.size, pend: g.pend.size,
      works: [...g.works.entries()].map(([wid, s]) => ({ name: work.get(wid)?.name ?? "—", n: s.size })).sort((a, b) => b.n - a.n),
    })).sort((a, b) => b.people - a.people);
    const people = new Set(inRange.map((a: any) => a.collaborator_id)).size;
    const activeWorks = worksQ.data.filter((w: any) => w.active !== false && w.status !== "completed").length;
    // Ausências do período (pessoas diferentes por tipo).
    const abs = { folga: new Set<string>(), ferias: new Set<string>(), atestado: new Set<string>(), falta: new Set<string>() };
    for (const b of rangeQ.data.boxes) { const k = ABSENCE[b.box_key]; if (k) abs[k].add(b.collaborator_id); }
    for (const o of rangeQ.data.off) abs.folga.add(o.collaborator_id);
    for (const v of rangeQ.data.vac) abs.ferias.add(v.collaborator_id);
    const absParts = (Object.keys(abs) as (keyof typeof abs)[]).map((k) => ({
      key: k, label: ABS_LABEL[k], n: abs[k].size,
      names: [...abs[k]].map((id) => person.get(id) ?? "—").sort((a, b) => a.localeCompare(b, "pt-BR")),
    }));
    const absTotal = new Set(Object.values(abs).flatMap((s) => [...s])).size;
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
    const worksSet = new Set(inRange.filter((a: any) => a.service_assigned).map((a: any) => a.work_id));
    const worksByClient = clients.filter((c) => c.works.length).map((c) => ({ name: c.name, n: c.works.length }));
    return {
      series, avg, people, patioDays, patioCount: patioAll.size, workforce, clients, activeWorks, absParts, absTotal, vehicles,
      kmTotal: vehicles.reduce((a, v) => a + (v.km ?? 0), 0), maint: vehicles.filter((v) => v.maint).length,
      worksCount: worksSet.size, worksByClient, pendTotal: clients.reduce((a, c) => a + c.pend, 0),
    };
  }, [worksQ.data, allocQ.data, rangeQ.data, cadQ.data, vehOrderQ.data, R.from, R.to, single, today, mFrom, mTo, qFrom, qTo]);

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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
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
            <OverviewCard title={`Ausências — ${pLabel}`} to="/ausencias" linkLabel="Ver Ausências" hint="Folgas, férias, atestados e faltas (quadros da Programação e lançamentos); no período, pessoas diferentes. Clique numa fatia para ver as pessoas." className="min-h-0 xl:col-start-4" bodyClassName="flex min-h-0 flex-col">
              <AbsencePie total={d.absTotal} parts={d.absParts} />
            </OverviewCard>
          </div>
          <OverviewCard title={`Escalações — ${pLabel} · ${d.clients.length} clientes · ${d.worksCount} serviços · ${d.people} pessoas`} to="/programacao/servicos" linkLabel="Abrir Serviços"
            hint="Pessoas escaladas por cliente no período" className="shrink-0 xl:h-[13.25rem]" bodyClassName="min-h-0 overflow-hidden">
            {!d.clients.length ? <p className="py-10 text-center text-xs text-muted-foreground">Sem escalações no período.</p> : (
              <div className="grid h-full grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none xl:grid-rows-1 xl:overflow-hidden">
                {d.clients.slice(0, 8).map((c) => <ClientTile key={c.name} c={c} single={single} />)}
              </div>
            )}
          </OverviewCard>
        </>
      )}
    </div>
  );
}

type ClientRow = { name: string; people: number; personDays: number; days: number; pend: number; works: { name: string; n: number }[] };
/** Quadro de um cliente na faixa de Escalações: pessoas, distribuição, serviços com quantas pessoas cada. */
function ClientTile({ c, single }: { c: ClientRow; single: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
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

type AbsPart = { key: string; label: string; n: number; names: string[] };
const PIE_TONES = [1, 0.65, 0.4, 0.2];
/** Fatia da pizza (ângulos em voltas, 0 = topo). */
/** Pizza 3D: elipse inclinada (RX × RY) com espessura DEPTH desenhada em camadas mais escuras por baixo. */
const RX = 48, RY = 30, CY = 34, DEPTH = 12;
function slicePath(a0: number, a1: number, dy = 0) {
  const p = (t: number) => `${(50 + RX * Math.sin(2 * Math.PI * t)).toFixed(2)} ${(CY + dy - RY * Math.cos(2 * Math.PI * t)).toFixed(2)}`;
  const mid = (a0 + a1) / 2; // dois arcos: cobre também a pizza inteira (uma só situação)
  return `M50 ${CY + dy} L${p(a0)} A${RX} ${RY} 0 0 1 ${p(mid)} A${RX} ${RY} 0 0 1 ${p(a1)} Z`;
}
/** Cor da fatia (tom do texto sobre o fundo do quadro) e da lateral (mais escura). */
const toneFill = (tone: number, side = false) =>
  side ? `color-mix(in oklab, color-mix(in oklab, var(--foreground) ${Math.round(tone * 100)}%, var(--card)) 72%, black)`
    : `color-mix(in oklab, var(--foreground) ${Math.round(tone * 100)}%, var(--card))`;

/**
 * Ausências em pizza (folgas, férias, atestados, faltas). Clicar numa fatia: a pizza encolhe para o canto, as outras
 * fatias somem e a lista das pessoas entra; "Voltar" faz o caminho inverso.
 */
function AbsencePie({ total, parts }: { total: number; parts: AbsPart[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const sum = parts.reduce((a, p) => a + p.n, 0);
  const cur = parts.find((p) => p.key === sel) ?? null;
  let acc = 0;
  const slices = parts.filter((p) => p.n > 0).map((p) => {
    const i = parts.indexOf(p);
    const a0 = acc / sum; acc += p.n; const a1 = acc / sum;
    return { ...p, i, a0, a1, mid: (a0 + a1) / 2 };
  });
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div className="relative min-h-[14rem] flex-1 overflow-hidden" onClick={stop}>
      {/* Pizza: no centro com a legenda; com fatia escolhida, encolhe para o canto de cima. */}
      <div className={cn("absolute flex items-center gap-4 transition-all duration-700 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
        "left-0 top-0", cur ? "h-16 w-16" : "h-full w-full")}>
        <div className={cn("relative aspect-[100/82] shrink-0 transition-all duration-700", cur ? "h-14 max-w-16" : "h-full max-w-[60%]")}>
          {!sum ? (
            <div className="flex h-full items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">Ninguém fora</div>
          ) : (
            <svg viewBox="0 0 100 82" className="h-full w-full overflow-visible">
              {/* 1º as laterais de todas as fatias (de trás para a frente), depois os topos: assim nenhuma lateral cobre o topo de outra. */}
              {(["side", "top"] as const).map((layer) => slices.map((sl) => {
                const out = (hover === sl.key && !cur) ? 4 : 0;
                const dx = out * Math.sin(2 * Math.PI * sl.mid), dy = -out * 0.62 * Math.cos(2 * Math.PI * sl.mid);
                const hidden = cur && cur.key !== sl.key;
                const tone = PIE_TONES[sl.i]!;
                return (
                  <g key={`${layer}-${sl.key}`} style={{ transform: `translate(${dx}px, ${dy}px)`, opacity: hidden ? 0 : 1, transition: "transform 300ms, opacity 500ms" }}>
                    {layer === "side"
                      ? Array.from({ length: DEPTH }, (_, k) => DEPTH - k).map((k) => <path key={k} d={slicePath(sl.a0, sl.a1, k)} style={{ fill: toneFill(tone, true) }} />)
                      : <>
                        <path d={slicePath(sl.a0, sl.a1)} style={{ fill: toneFill(tone) }} className="stroke-card" strokeWidth="0.6" />
                        <title>{`${sl.label}: ${sl.n}`}</title>
                        {!cur && <path d={slicePath(sl.a0, sl.a1)} fill="transparent" className="cursor-pointer"
                          onMouseEnter={() => setHover(sl.key)} onMouseLeave={() => setHover(null)} onClick={(e) => { stop(e); setHover(null); setSel(sl.key); }} />}
                      </>}
                  </g>
                );
              }))}
            </svg>
          )}
        </div>
        <div className={cn("min-w-0 space-y-2 transition-opacity duration-300", cur ? "pointer-events-none opacity-0" : "opacity-100 delay-300")}>
          <div><span className="font-display text-3xl font-semibold tabular-nums"><CountUp value={total} /></span><p className="text-xs text-muted-foreground">fora da escala</p></div>
          {parts.map((p, i) => (
            <button key={p.key} type="button" disabled={!p.n} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}
              onClick={(e) => { stop(e); setHover(null); setSel(p.key); }}
              className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-muted disabled:opacity-50">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-foreground" style={{ opacity: PIE_TONES[i] }} />
              <span className="flex-1">{p.label}</span><b className="tabular-nums">{p.n}</b>
            </button>
          ))}
          <p className="text-[10px] text-muted-foreground">Clique numa fatia para ver as pessoas.</p>
        </div>
      </div>
      {/* Pessoas da fatia escolhida. */}
      <div className={cn("absolute inset-0 flex flex-col transition-all duration-700 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
        cur ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0")}>
        <div className="flex h-16 items-center gap-3 pl-20">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{cur?.label}</p>
            <p className="text-xs text-muted-foreground">{cur?.n} {cur?.n === 1 ? "pessoa" : "pessoas"}{sum ? ` · ${Math.round(((cur?.n ?? 0) / sum) * 100)}%` : ""}</p>
          </div>
          <Button size="sm" variant="outline" onClick={(e) => { stop(e); setSel(null); }}><ArrowLeft className="h-3.5 w-3.5" /> Voltar</Button>
        </div>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-xs">
          {(cur?.names ?? []).map((n, i) => (
            <li key={`${n}-${i}`} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1"
              style={{ transition: "opacity 400ms, transform 400ms", transitionDelay: cur ? `${200 + Math.min(i, 20) * 25}ms` : "0ms", opacity: cur ? 1 : 0, transform: cur ? "none" : "translateY(6px)" }}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">{n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("")}</span>
              <span className="truncate">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

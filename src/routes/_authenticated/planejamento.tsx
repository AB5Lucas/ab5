import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { Big, HoverBars, OverviewCard } from "@/components/overview/charts";
import { PatioCalendar } from "@/components/overview/patio-calendar";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/planejamento")({
  head: () => ({ meta: [{ title: "Planejamento | AB5 Hub" }, { name: "description", content: "Visão geral da programação: escalações, ausências, transporte e Pátio." }] }),
  component: PlanejamentoOverview,
});

const STATIC = 5 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ABSENCE: Record<string, "folga" | "ferias" | "atestado" | "falta"> = {
  folga: "folga", ferias: "ferias", atestado: "atestado", medico: "atestado", afastado: "atestado", licenca: "atestado", falta: "falta",
};
const ABS_LABEL = { folga: "Folgas", ferias: "Férias", atestado: "Atestados", falta: "Faltas" } as const;

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
  const ym = today.slice(0, 7);
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  const from = `${ym}-01`, to = `${ym}-${pad(lastDay)}`;

  const worksQ = useQuery({ queryKey: ["overview", "plan-works"], staleTime: STATIC, queryFn: () => fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, status, active, clients(name)").order("id").range(a, b)) });
  const monthQ = useQuery({
    queryKey: ["overview", "plan-month", from, to], staleTime: 60_000,
    queryFn: () => fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id, collaborator_id, daily_schedules!inner(schedule_date)")
      .gte("daily_schedules.schedule_date", from).lte("daily_schedules.schedule_date", to).order("id").range(a, b)),
  });
  const todayQ = useQuery({
    queryKey: ["overview", "plan-today", today], staleTime: 60_000,
    queryFn: async () => {
      const [alloc, boxes, off, vac, veh] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id, collaborator_id, service_assigned, daily_schedules!inner(schedule_date)").eq("daily_schedules.schedule_date", today).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("collaborator_id, box_key, daily_schedules!inner(schedule_date)").eq("daily_schedules.schedule_date", today).order("id").range(a, b)),
        supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", today).or(`end_date.gte.${today},and(end_date.is.null,date.eq.${today})`),
        supabase.from("vacations").select("collaborator_id, status").lte("start_date", today).gte("end_date", today),
        supabase.from("vehicle_schedules").select("vehicle_id, driver_id, client_id, km, is_maintenance, maintenance_kind, external_place, adm_place, is_suzano_local, vehicles(plate, model)").eq("schedule_date", today),
      ]);
      return { alloc, boxes, off: off.data ?? [], vac: (vac.data ?? []).filter((v) => v.status !== "cancelled" && v.status !== "cancelada"), veh: veh.data ?? [] };
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
    if (!worksQ.data || !monthQ.data || !todayQ.data || !cadQ.data) return null;
    const work = new Map(worksQ.data.map((w: any) => [w.id, w]));
    const clientOf = (wid: string | null) => (wid ? (work.get(wid) as any)?.clients?.name ?? "—" : "—");
    const clientName = new Map(cadQ.data.clients.map((c) => [c.id, c.name]));
    const person = new Map(cadQ.data.collabs.map((c: any) => [c.id, c.full_name as string]));
    const workforce = cadQ.data.collabs.filter((c: any) => c.status === "active").length;
    // Mês: pessoas por dia e Pátio.
    const days = Array.from({ length: lastDay }, (_, i) => `${ym}-${pad(i + 1)}`);
    const ppl = new Map(days.map((x) => [x, new Set<string>()]));
    const patio = new Map(days.map((x) => [x, new Set<string>()]));
    const patioAll = new Set<string>();
    for (const a of monthQ.data) {
      const dt = a.daily_schedules?.schedule_date as string;
      ppl.get(dt)?.add(a.collaborator_id);
      if (norm(clientOf(a.work_id)) === "PATIO") { patio.get(dt)?.add(a.collaborator_id); patioAll.add(a.collaborator_id); }
    }
    const past = days.filter((x) => x <= today);
    const series = past.map((x) => ({ label: brDay(x), value: ppl.get(x)!.size, tip: `${brDay(x)}: ${ppl.get(x)!.size} pessoas` }));
    const withPpl = series.filter((s) => s.value > 0);
    const avg = withPpl.length ? Math.round(withPpl.reduce((a, s) => a + s.value, 0) / withPpl.length) : 0;
    const patioDays = days.map((x) => ({ key: x, label: String(Number(x.slice(8, 10))), title: brDay(x), value: patio.get(x)!.size }));
    // Hoje: escalações por cliente.
    const byClient = new Map<string, { people: Set<string>; works: Set<string>; pend: Set<string> }>();
    for (const a of todayQ.data.alloc) {
      const c = clientOf(a.work_id);
      const g = byClient.get(c) ?? { people: new Set(), works: new Set(), pend: new Set() };
      g.people.add(a.collaborator_id);
      if (a.service_assigned) g.works.add(a.work_id); else g.pend.add(a.collaborator_id);
      byClient.set(c, g);
    }
    const clients = [...byClient.entries()].map(([name, g]) => ({ name, people: g.people.size, works: g.works.size, pend: g.pend.size }))
      .sort((a, b) => b.people - a.people);
    const todayPeople = new Set(todayQ.data.alloc.map((a: any) => a.collaborator_id)).size;
    const activeWorks = worksQ.data.filter((w: any) => w.active !== false && w.status !== "completed").length;
    // Ausências de hoje (quadros do dia + folgas/férias lançadas).
    const abs = { folga: new Set<string>(), ferias: new Set<string>(), atestado: new Set<string>(), falta: new Set<string>() };
    for (const b of todayQ.data.boxes) { const k = ABSENCE[b.box_key]; if (k) abs[k].add(b.collaborator_id); }
    for (const o of todayQ.data.off) abs.folga.add(o.collaborator_id);
    for (const v of todayQ.data.vac) abs.ferias.add(v.collaborator_id);
    const absParts = (Object.keys(abs) as (keyof typeof abs)[]).map((k) => ({ key: k, label: ABS_LABEL[k], n: abs[k].size }));
    const absTotal = new Set(Object.values(abs).flatMap((s) => [...s])).size;
    // Transporte de hoje.
    const vehicles = todayQ.data.veh.map((v: any) => {
      const maint = !!v.is_maintenance;
      const client = maint ? (v.maintenance_kind === "revisao" ? "REVISÃO" : "MANUTENÇÃO")
        : v.is_suzano_local ? "SUZANO LOCAL" : v.external_place ?? v.adm_place ?? (v.client_id ? clientName.get(v.client_id) ?? "—" : "—");
      return { plate: v.vehicles?.plate ?? "—", model: v.vehicles?.model ?? "", client, maint, driver: v.driver_id ? (person.get(v.driver_id) ?? "").split(" ")[0] : "a definir", km: maint ? null : Number(v.km ?? 0) };
    }).sort((a: any, b: any) => Number(a.maint) - Number(b.maint) || a.client.localeCompare(b.client));
    return {
      series, avg, todayPeople, patioDays, patioCount: patioAll.size, workforce, clients, activeWorks, absParts, absTotal, vehicles,
      kmTotal: vehicles.reduce((a: number, v: any) => a + (v.km ?? 0), 0), maint: vehicles.filter((v: any) => v.maint).length,
      worksToday: clients.reduce((a, c) => a + c.works, 0), pendTotal: clients.reduce((a, c) => a + c.pend, 0),
    };
  }, [worksQ.data, monthQ.data, todayQ.data, cadQ.data, today, ym, lastDay]);

  const month = MONTHS[Number(ym.slice(5, 7)) - 1];
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-6.5rem)] lg:min-h-[640px]">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">Planejamento</h1>
        <p className="hidden text-xs text-muted-foreground md:block">Hoje, {brDay(today)}. Clique em um quadro para abrir a página.</p>
      </div>
      {!d ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4 xl:grid-rows-[auto_minmax(0,1fr)]">
            <OverviewCard dark title="Pessoas escaladas por dia" to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas alocadas nos clientes na Programação" bodyClassName="flex flex-col">
              <div className="flex items-baseline gap-2">
                <Big dark value={d.todayPeople} />
                <span className="text-xs text-background/60">hoje · média do mês {d.avg}</span>
              </div>
              <div className="mt-auto pt-2"><HoverBars dark data={d.series} format={(v) => `${v} pessoas`} height="h-16" /></div>
            </OverviewCard>
            <OverviewCard title="Ausências — hoje" to="/ausencias" linkLabel="Ver Ausências" hint="Folgas, férias, atestados e faltas do dia (quadros da Programação e lançamentos)">
              <div className="flex items-baseline gap-2"><Big value={d.absTotal} /><span className="text-xs text-muted-foreground">fora da escala</span></div>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
                {d.absParts.map((p, i) => <span key={p.key} className={cn("ov-grow h-full", ["bg-foreground", "bg-foreground/65", "bg-foreground/40", "bg-foreground/20"][i])} style={{ width: `${(p.n / Math.max(1, d.absParts.reduce((a, x) => a + x.n, 0))) * 100}%` }} />)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {d.absParts.map((p, i) => (
                  <span key={p.key} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", ["bg-foreground", "bg-foreground/65", "bg-foreground/40", "bg-foreground/20"][i])} />{p.label} <b className="tabular-nums">{p.n}</b></span>
                ))}
              </div>
            </OverviewCard>
            <OverviewCard title="Transporte — hoje" to="/veiculos/transporte" linkLabel="Abrir Transporte" hint="Veículos na escala da Transporte hoje" className="xl:row-span-2 min-h-0" bodyClassName="flex min-h-0 flex-col">
              <div className="grid grid-cols-3 gap-2">
                {[[d.vehicles.length, "veículos"], [d.maint, "manutenção"], [d.kmTotal, "km de ida"]].map(([v, l]) => (
                  <div key={l as string}><div className="font-display text-2xl font-semibold tabular-nums"><CountUp value={v as number} /></div><div className="text-[11px] text-muted-foreground">{l}</div></div>
                ))}
              </div>
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                {!d.vehicles.length && <p className="py-6 text-center text-xs text-muted-foreground">Sem escala de veículos hoje.</p>}
                {d.vehicles.map((v: any, i: number) => (
                  <div key={`${v.plate}-${i}`} className="grid grid-cols-[4.2rem_minmax(0,1fr)_3rem] items-center gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
                    <span className="font-display text-[13px] font-semibold">{v.plate}</span>
                    <span className="min-w-0">
                      <span className={cn("block truncate", v.maint ? "italic text-muted-foreground" : "font-medium")}>{v.client}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">{v.model} · {v.driver}</span>
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-muted-foreground">{v.km == null ? "—" : `${v.km} km`}</span>
                  </div>
                ))}
              </div>
            </OverviewCard>
            <OverviewCard title="Sem serviço distribuído — hoje" to="/programacao/servicos" linkLabel="Abrir Serviços" hint="Pessoas escaladas no cliente ainda sem serviço na aba Serviços">
              <div className="flex items-baseline gap-2"><Big value={d.pendTotal} /><span className="text-xs text-muted-foreground">pessoas na aba Serviços</span></div>
              <ClientBars rows={d.clients.filter((c) => c.pend > 0).map((c) => ({ name: c.name, n: c.pend }))} empty="Todos distribuídos." limit={4} />
            </OverviewCard>
            <OverviewCard dark title={`Pessoas no Pátio — ${month}`} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas escaladas no cliente Pátio no mês" className="md:col-span-2 min-h-0" bodyClassName="min-h-0 overflow-hidden">
              <div onClick={(e) => e.preventDefault()}><PatioCalendar dark days={d.patioDays} unit="day" total={d.patioCount} workforce={d.workforce} /></div>
            </OverviewCard>
            <OverviewCard title="Serviços com equipe — hoje" to="/programacao/servicos" linkLabel="Abrir Serviços" hint="Serviços com gente distribuída hoje, por cliente" className="min-h-0 xl:col-start-4" bodyClassName="min-h-0 overflow-hidden">
              <div className="flex items-baseline gap-2"><Big value={d.worksToday} /><span className="text-xs text-muted-foreground">de {d.activeWorks} serviços ativos</span></div>
              <ClientBars rows={d.clients.filter((c) => c.works > 0).map((c) => ({ name: c.name, n: c.works }))} empty="Nenhum serviço com equipe hoje." limit={8} />
            </OverviewCard>
          </div>
          <OverviewCard title={`Escalações de hoje — ${d.clients.length} clientes · ${d.worksToday} serviços · ${d.todayPeople} pessoas`} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas escaladas por cliente hoje" className="shrink-0 lg:h-40" bodyClassName="min-h-0 overflow-hidden">
            {!d.clients.length ? <p className="py-6 text-center text-xs text-muted-foreground">Programação de hoje sem escalações.</p> : (
              <div className="grid h-full auto-rows-fr grid-cols-2 gap-2 overflow-hidden sm:grid-cols-4 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none lg:grid-rows-1">
                {d.clients.slice(0, 10).map((c) => (
                  <div key={c.name} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-muted/40 px-2.5 py-2">
                    <span className="truncate text-[11px] font-semibold tracking-wide">{c.name}</span>
                    <span className="flex items-baseline gap-1"><span className="font-display text-2xl font-semibold leading-none tabular-nums"><CountUp value={c.people} /></span><span className="text-[11px] text-muted-foreground">pessoas</span></span>
                    <span className="flex h-3.5 flex-wrap gap-[3px] overflow-hidden">
                      {Array.from({ length: Math.min(c.people, 24) }, (_, i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-[2px]", i < c.people - c.pend ? "bg-foreground" : "bg-foreground/25")} />)}
                    </span>
                    <span className="mt-auto flex justify-between gap-1 text-[10.5px] text-muted-foreground">
                      <span>{c.works} {c.works === 1 ? "serviço" : "serviços"}</span><span className="truncate">{c.pend ? `${c.pend} sem serviço` : "distribuído"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </OverviewCard>
        </>
      )}
    </div>
  );
}

function ClientBars({ rows, empty, limit }: { rows: { name: string; n: number }[]; empty: string; limit: number }) {
  if (!rows.length) return <p className="py-4 text-center text-xs text-muted-foreground">{empty}</p>;
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...sorted.map((r) => r.n));
  return (
    <div className="mt-2 space-y-1.5">
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

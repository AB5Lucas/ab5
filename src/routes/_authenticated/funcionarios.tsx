import { FitScreen } from "@/components/overview/fit-screen";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { Big, Donut, HoverBars, OverviewCard } from "@/components/overview/charts";
import { Pie3D } from "@/components/overview/pie-3d";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { DOC_WARN_DAYS } from "@/lib/doc-status";

export const Route = createFileRoute("/_authenticated/funcionarios")({
  pendingComponent: DashboardSkeleton,
  head: () => ({ meta: [{ title: "Funcionários | AB5 Hub" }, { name: "description", content: "Visão geral dos funcionários: quadro, ausências, agendamentos, contratações e vencimentos." }] }),
  component: FuncionariosOverview,
});

const STATIC = 5 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (iso: string, n: number) => isoOf(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000));
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR");

type Period = "hoje" | "amanha" | "semana" | "mes";
const PERIODS: { key: Period; label: string }[] = [
  { key: "hoje", label: "Hoje" }, { key: "amanha", label: "Amanhã" }, { key: "semana", label: "Esta semana" }, { key: "mes", label: "Mês atual" },
];
function rangeOf(p: Period, today: string) {
  if (p === "hoje") return { from: today, to: today };
  if (p === "amanha") { const t = addDays(today, 1); return { from: t, to: t }; }
  if (p === "semana") {
    const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const mon = addDays(today, -wd);
    return { from: mon, to: addDays(mon, 6) };
  }
  const ym = today.slice(0, 7);
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

/** Quadros do dia da Programação que contam como ausência, por tipo da pizza. */
const BOX_KIND: Record<string, AbsKind> = { folga: "folga", ferias: "ferias", atestado: "atestado", medico: "atestado", afastado: "atestado", licenca: "atestado", falta: "falta" };
type AbsKind = "folga" | "ferias" | "atestado" | "falta";
const ABS_PARTS: [AbsKind, string][] = [["folga", "Folgas"], ["ferias", "Férias"], ["atestado", "Atestados"], ["falta", "Faltas"]];
const CONTRACT: [string, string, string][] = [["efetivo", "Efetivo", "bg-background"], ["intermitente", "Intermitente", "bg-background/55"], ["pj", "PJ", "bg-background/25"]];
const TYPE_LABEL: Record<string, string> = { aso: "ASO", integracao: "Integração", treinamento: "Treinamento" };
const HIRING_OPEN = new Set(["aberta", "analise", "aguardando", "processo", "parcial"]);

/** Visão geral do módulo Funcionários (25/11): quadro de pessoas, ausências, agendamentos, contratações e vencimentos. */
function FuncionariosOverview() {
  const { canAccess, loading } = useAccess();
  const nav = useNavigate();
  const allowed = canAccess("/colaboradores");
  useEffect(() => { if (!loading && !allowed) nav({ to: "/dashboard", replace: true }); }, [loading, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <DashboardSkeleton />;
  if (!allowed) return null;
  return <Overview />;
}

function Overview() {
  const today = todayIso();
  const [period, setPeriod] = useState<Period>("mes");
  const R = rangeOf(period, today);
  const single = R.from === R.to;
  const ym = R.from.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const mFrom = `${ym}-01`, mTo = `${ym}-${pad(lastDay)}`;
  // Ausências: lê o mês inteiro (barras por dia) e o período, o que for maior.
  const qFrom = R.from < mFrom ? R.from : mFrom, qTo = R.to > mTo ? R.to : mTo;

  const cadQ = useQuery({
    queryKey: ["overview", "func-cad"], staleTime: STATIC,
    queryFn: async () => {
      const [co, pos, hr] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, status, contract_type, position_id, hire_date, notice_start, notice_end").order("id").range(a, b)),
        supabase.from("positions").select("id, name"),
        supabase.from("hiring_requests").select("id, number, status, quantity, filled, position_name, desired_date, priority, clients(name)").order("number", { ascending: false }),
      ]);
      return { collabs: co, positions: pos.data ?? [], hiring: (hr.data ?? []) as any[] };
    },
  });
  const docsQ = useQuery({
    queryKey: ["overview", "func-docs"], staleTime: STATIC,
    queryFn: async () => fetchAll<any>((a, b) => supabase.from("asos").select("id, collaborator_id, exam_date, expires_at").order("id").range(a, b)),
  });
  const absQ = useQuery({
    queryKey: ["overview", "func-abs", qFrom, qTo], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => {
      const [box, off, vac, med] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("id, collaborator_id, box_key, daily_schedules!inner(schedule_date)")
          .gte("daily_schedules.schedule_date", qFrom).lte("daily_schedules.schedule_date", qTo).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("days_off").select("id, collaborator_id, date, end_date").lte("date", qTo).or(`end_date.gte.${qFrom},date.gte.${qFrom}`).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("vacations").select("id, collaborator_id, start_date, end_date, status").lte("start_date", qTo).gte("end_date", qFrom).order("id").range(a, b)),
        fetchAll<any>((a, b) => (supabase.from("medical_leaves" as never) as any).select("id, collaborator_id, start_date, end_date").lte("start_date", qTo).gte("end_date", qFrom).order("id").range(a, b)),
      ]);
      return { box, off, vac, med };
    },
  });
  const apQ = useQuery({
    queryKey: ["overview", "func-ap", R.from, R.to], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => fetchAll<any>((a, b) => supabase.from("appointments").select("id, type, status, scheduled_date, collaborator_id")
      .gte("scheduled_date", R.from).lte("scheduled_date", R.to).neq("status", "cancelado").order("id").range(a, b)),
  });

  const d = useMemo(() => {
    if (!cadQ.data || !absQ.data || !apQ.data || !docsQ.data) return null;
    const collabs = cadQ.data.collabs;
    const active = collabs.filter((c: any) => c.status === "active");
    const person = new Map<string, string>(collabs.map((c: any) => [c.id, c.full_name]));
    // Quadro de pessoas por contrato.
    const contract = CONTRACT.map(([k, label, cls]) => ({ label, className: cls, value: active.filter((c: any) => (c.contract_type ?? "efetivo") === k).length }));
    const hired = collabs.filter((c: any) => c.hire_date && c.hire_date >= R.from && c.hire_date <= R.to).length;
    const notice = active.filter((c: any) => c.notice_start && c.notice_start <= R.to && (!c.notice_end || c.notice_end >= R.from));

    // Ausências: pessoas diferentes por tipo no período; pessoas ausentes por dia no mês.
    const kinds = new Map<AbsKind, Set<string>>(ABS_PARTS.map(([k]) => [k, new Set()]));
    const perDay = new Map(daysBetween(mFrom, mTo).map((x) => [x, new Set<string>()]));
    const mark = (kind: AbsKind, id: string, from: string, to: string) => {
      const a = from < qFrom ? qFrom : from, b = to > qTo ? qTo : to;
      for (let x = a; x <= b; x = addDays(x, 1)) {
        if (x >= R.from && x <= R.to) kinds.get(kind)!.add(id);
        perDay.get(x)?.add(id);
      }
    };
    for (const e of absQ.data.box) { const k = BOX_KIND[e.box_key]; if (k) { const dt = e.daily_schedules?.schedule_date; mark(k, e.collaborator_id, dt, dt); } }
    for (const o of absQ.data.off) mark("folga", o.collaborator_id, o.date, o.end_date ?? o.date);
    for (const v of absQ.data.vac) if (!String(v.status ?? "").startsWith("cancel")) mark("ferias", v.collaborator_id, v.start_date, v.end_date);
    for (const m of absQ.data.med) mark("atestado", m.collaborator_id, m.start_date, m.end_date ?? m.start_date);
    const absParts = ABS_PARTS.map(([key, label]) => {
      const ids = [...kinds.get(key)!];
      return { key, label, n: ids.length, names: ids.map((id) => person.get(id) ?? "—").sort(byName) };
    });
    const absAll = new Set(absParts.flatMap((p) => [...kinds.get(p.key as AbsKind)!])).size;
    const absSeries = daysBetween(mFrom, mTo).filter((x) => x <= (R.to > today ? R.to : today))
      .map((x) => ({ label: brDay(x), value: perDay.get(x)!.size, tip: `${brDay(x)}: ${perDay.get(x)!.size} ausentes` }));
    const absToday = perDay.get(today)?.size ?? 0;

    // Agendamentos do período por tipo.
    const ap = apQ.data;
    const apTypes = (["aso", "integracao", "treinamento"] as const).map((t) => {
      const rows = ap.filter((a: any) => a.type === t);
      return { key: t, label: TYPE_LABEL[t]!, total: rows.length, done: rows.filter((a: any) => a.status === "realizado").length };
    });
    const apDone = ap.filter((a: any) => a.status === "realizado").length;
    const apLate = ap.filter((a: any) => a.status === "agendado" && a.scheduled_date < today).length;

    // Contratações em aberto.
    const open = cadQ.data.hiring.filter((h) => HIRING_OPEN.has(h.status));
    const vagas = open.reduce((a, h) => a + Math.max(0, (h.quantity ?? 1) - (h.filled ?? 0)), 0);
    const closedPeriod = cadQ.data.hiring.filter((h) => h.status === "atendida").length;

    // Vencimentos de ASO dos ativos (Consulta).
    const lastAso = new Map<string, any>();
    for (const a of docsQ.data) { const p = lastAso.get(a.collaborator_id); if (!p || a.exam_date > p.exam_date) lastAso.set(a.collaborator_id, a); }
    const warn = addDays(today, DOC_WARN_DAYS);
    const aso = { ok: 0, soon: 0, late: 0, none: 0 };
    for (const c of active) {
      const a = lastAso.get(c.id);
      if (!a) aso.none++; else if (a.expires_at && a.expires_at < today) aso.late++; else if (a.expires_at && a.expires_at <= warn) aso.soon++; else aso.ok++;
    }

    // Pessoas ativas por função (sem o nível N1–N4).
    const posName = new Map(cadQ.data.positions.map((p: any) => [p.id, String(p.name ?? "").replace(/\s*N\s*[1-4]\s*$/i, "").trim()]));
    const fn = new Map<string, number>();
    for (const c of active) { const n = (c.position_id && posName.get(c.position_id)) || "Sem função"; fn.set(n, (fn.get(n) ?? 0) + 1); }
    const functions = [...fn.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

    return {
      total: active.length, contract, hired, notice: notice.map((c: any) => ({ name: c.full_name as string, end: c.notice_end as string | null })).sort((a: any, b: any) => byName(a.name, b.name)),
      absParts, absAll, absSeries, absToday, apTypes, apTotal: ap.length, apDone, apLate, open, vagas, closedPeriod, aso, functions,
    };
  }, [cadQ.data, absQ.data, apQ.data, docsQ.data, R.from, R.to, today, mFrom, mTo, qFrom, qTo]);

  const pLabel = period === "hoje" ? "hoje" : period === "amanha" ? "amanhã" : period === "semana" ? "esta semana" : "mês atual";
  const when = single ? brDay(R.from) : `${brDay(R.from)} a ${brDay(R.to)}`;
  const loadingNew = absQ.isPlaceholderData || apQ.isPlaceholderData;
  return (
    <FitScreen>
    <div className={cn("flex flex-col gap-3 transition-opacity duration-300 lg:h-full", loadingNew && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">Funcionários</h1>
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
      {!d ? <DashboardSkeleton /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:grid-rows-[13.25rem_minmax(0,1fr)]">
          <OverviewCard dark title="Colaboradores ativos" to="/colaboradores" linkLabel="Abrir Colaboradores" hint="Colaboradores ativos no cadastro, por tipo de contrato" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <div className="flex items-baseline justify-between gap-2">
              <Big dark value={d.total} />
              <span className="text-right text-[11px] text-background/60">{d.hired} {d.hired === 1 ? "admissão" : "admissões"} · {d.notice.length} em aviso</span>
            </div>
            <div className="mt-auto">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-background/10">
                {d.contract.map((p, i) => <div key={p.label} className={cn("ov-widen h-full", p.className)} style={{ width: `${(p.value / Math.max(1, d.total)) * 100}%`, animationDelay: `${i * 90}ms` }} title={`${p.label}: ${p.value}`} />)}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {d.contract.map((p) => (
                  <div key={p.label}>
                    <div className="flex items-center gap-1.5 text-[11px] text-background/60"><span className={cn("h-2 w-2 rounded-full", p.className)} />{p.label}</div>
                    <div className="font-display text-xl font-semibold tabular-nums"><CountUp value={p.value} /></div>
                  </div>
                ))}
              </div>
            </div>
          </OverviewCard>

          <OverviewCard title={`Agendamentos — ${pLabel}`} to="/documentos/agendamentos" linkLabel="Abrir Agendamentos" hint="ASO, integrações e treinamentos agendados ou realizados no período (cancelados fora)" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <div className="flex items-baseline gap-2"><Big value={d.apTotal} /><span className="text-xs text-muted-foreground">{d.apDone} realizados{d.apLate > 0 && ` · ${d.apLate} atrasados`}</span></div>
            <div className="mt-auto space-y-1.5">
              {d.apTypes.map((t, i) => (
                <div key={t.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-[11px]" title={`${t.label}: ${t.done} de ${t.total} realizados`}>
                  <span className="truncate">{t.label}</span>
                  <span className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="ov-widen absolute inset-y-0 left-0 rounded-full bg-foreground/25" style={{ width: `${(t.total / Math.max(1, ...d.apTypes.map((x) => x.total))) * 100}%`, animationDelay: `${i * 90}ms` }} />
                    <span className="ov-widen absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${(t.done / Math.max(1, ...d.apTypes.map((x) => x.total))) * 100}%`, animationDelay: `${i * 90 + 60}ms` }} />
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">{t.done}/{t.total}</span>
                </div>
              ))}
            </div>
          </OverviewCard>

          <OverviewCard title="Contratações em aberto" to="/demandas/contratacoes" linkLabel="Abrir Contratações" hint="Solicitações de contratação abertas ou em andamento e vagas ainda não preenchidas" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <div className="flex items-baseline gap-2"><Big value={d.vagas} /><span className="text-xs text-muted-foreground">{d.vagas === 1 ? "vaga" : "vagas"} · {d.open.length} {d.open.length === 1 ? "solicitação" : "solicitações"}</span></div>
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-hidden text-[11px]">
              {!d.open.length && <p className="py-3 text-center text-muted-foreground">Nenhuma em aberto · {d.closedPeriod} atendidas</p>}
              {d.open.slice(0, 4).map((h: any, i: number) => (
                <div key={h.id} className="ov-fade flex items-center justify-between gap-2 border-b border-border/60 pb-1 last:border-0" style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="min-w-0 truncate"><b>{h.position_name ?? "—"}</b><span className="text-muted-foreground"> · {h.clients?.name ?? "—"}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{h.filled ?? 0}/{h.quantity ?? 1}</span>
                </div>
              ))}
            </div>
          </OverviewCard>

          <OverviewCard title="ASO dos ativos" to="/consulta" linkLabel="Abrir Consulta" hint={`Situação do ASO de cada colaborador ativo hoje (vencendo = próximos ${DOC_WARN_DAYS} dias)`} className="min-h-0">
            {(() => {
              const tot = Math.max(1, d.total);
              const rows: [string, number][] = [["Em dia", d.aso.ok], ["Vencendo", d.aso.soon], ["Vencidos", d.aso.late], ["Sem ASO", d.aso.none]];
              return (
                <div className="grid grid-cols-2 items-center gap-3">
                  <div className="space-y-1 text-[11px]">
                    {rows.map(([l, n]) => (
                      <div key={l} className="flex justify-between gap-2"><span className={cn(l === "Em dia" ? "text-muted-foreground" : "font-medium")}>{l}</span><b className="tabular-nums"><CountUp value={n} /></b></div>
                    ))}
                  </div>
                  <Donut frac={d.aso.ok / tot} center={`${Math.round((d.aso.ok / tot) * 100)}%`} sub="em dia" size="h-36 w-36" />
                </div>
              );
            })()}
          </OverviewCard>

          <OverviewCard title={`Ausências — ${pLabel}`} to="/ausencias" linkLabel="Abrir Ausências" hint="Pessoas diferentes com folga, férias, atestado ou falta no período (quadros da Programação + Ausências). Clique numa fatia para ver as pessoas." className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <Pie3D total={d.absAll} totalLabel="pessoas ausentes" parts={d.absParts} unit={["pessoa", "pessoas"]} />
          </OverviewCard>

          <OverviewCard dark title="Ausentes por dia" to="/ausencias" linkLabel="Abrir Ausências" hint="Pessoas ausentes em cada dia do mês (folga, férias, atestado ou falta)" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <Big dark value={d.absToday} />
            <p className="text-xs text-background/60">ausentes hoje · média {Math.round(d.absSeries.filter((s) => s.value).reduce((a, s) => a + s.value, 0) / Math.max(1, d.absSeries.filter((s) => s.value).length))} por dia</p>
            <div className="mt-auto pt-2"><HoverBars dark data={d.absSeries} format={(v) => `${v} ausentes`} height="h-28" /></div>
          </OverviewCard>

          <OverviewCard title="Pessoas por função" to="/colaboradores" linkLabel="Abrir Colaboradores" hint="Colaboradores ativos por função (todos os níveis juntos)" className="min-h-0" bodyClassName="min-h-0 overflow-y-auto pr-1">
            <FunctionBars rows={d.functions} />
          </OverviewCard>

          <OverviewCard title="Em aviso prévio" to="/colaboradores" linkLabel="Abrir Colaboradores" hint="Colaboradores ativos com aviso prévio no período e a data de fim" className="min-h-0" bodyClassName="flex min-h-0 flex-col">
            <Big value={d.notice.length} />
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-xs">
              {!d.notice.length && <p className="py-6 text-center text-muted-foreground">Ninguém em aviso prévio.</p>}
              {d.notice.map((n: any, i: number) => (
                <div key={n.name} className="ov-fade flex justify-between gap-2 border-b border-border/60 py-1.5 last:border-0" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="truncate">{n.name}</span>
                  <span className={cn("shrink-0 tabular-nums", n.end && n.end < today ? "font-medium" : "text-muted-foreground")}>{n.end ? `até ${brDay(n.end)}` : "—"}</span>
                </div>
              ))}
            </div>
          </OverviewCard>
        </div>
      )}
    </div>
    </FitScreen>
  );
}

function FunctionBars({ rows }: { rows: { name: string; n: number }[] }) {
  if (!rows.length) return <p className="py-4 text-center text-xs text-muted-foreground">Sem colaboradores ativos.</p>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.name} className="grid grid-cols-[7.5rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-[11px]" title={`${r.name}: ${r.n}`}>
          <span className="truncate">{r.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="ov-widen block h-full rounded-full bg-foreground" style={{ width: `${(r.n / max) * 100}%`, animationDelay: `${Math.min(i, 12) * 50}ms` }} /></span>
          <span className="text-right tabular-nums text-muted-foreground">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

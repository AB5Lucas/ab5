import { FitScreen } from "@/components/overview/fit-screen";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAccess } from "@/hooks/use-access";
import { Big, Donut, LineArea, OverviewCard } from "@/components/overview/charts";
import { Pie3D } from "@/components/overview/pie-3d";
import { CountUp } from "@/components/count-up";
import { TeamMosaic, type TeamPerson, type TeamStatus } from "@/components/overview/team-mosaic";
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
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
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

  // Treinamentos do mês inteiro (quadradinhos), independentemente do filtro.
  const trQ = useQuery({
    queryKey: ["overview", "func-tr", mFrom, mTo], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => fetchAll<any>((a, b) => supabase.from("appointments").select("id, status, scheduled_date, collaborator_id, trainings(name)")
      .eq("type", "treinamento").gte("scheduled_date", mFrom).lte("scheduled_date", mTo).neq("status", "cancelado").order("id").range(a, b)),
  });

  // Situação de cada pessoa no dia (mosaico): o dia escolhido, ou hoje quando o filtro tem vários dias.
  const day = single ? R.from : today;
  const dayQ = useQuery({
    queryKey: ["overview", "func-day", day], staleTime: 60_000, placeholderData: keepPreviousData,
    queryFn: async () => {
      const [al, box, ap, off, vac, med] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("daily_allocations").select("id, collaborator_id, works(name, clients(name)), daily_schedules!inner(schedule_date)").eq("daily_schedules.schedule_date", day).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("id, collaborator_id, box_key, daily_schedules!inner(schedule_date)").eq("daily_schedules.schedule_date", day).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("appointments").select("id, collaborator_id, type").eq("scheduled_date", day).in("status", ["agendado", "realizado"]).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("days_off").select("id, collaborator_id").lte("date", day).or(`end_date.gte.${day},date.eq.${day}`).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("vacations").select("id, collaborator_id, status").lte("start_date", day).gte("end_date", day).order("id").range(a, b)),
        fetchAll<any>((a, b) => (supabase.from("medical_leaves" as never) as any).select("id, collaborator_id").lte("start_date", day).gte("end_date", day).order("id").range(a, b)),
      ]);
      return { al, box, ap, off, vac: vac.filter((v: any) => !String(v.status ?? "").startsWith("cancel")), med };
    },
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
    const live = cadQ.data.hiring.filter((h) => h.status !== "cancelada");
    const filled = live.reduce((a, h) => a + Math.min(h.quantity ?? 1, h.filled ?? 0), 0);

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

    // Mosaico: situação de cada ativo no dia (ausente > treinamento/ASO/integração > obra/Pátio > sem escala).
    const team: TeamPerson[] = [];
    if (dayQ.data) {
      const st = new Map<string, { status: TeamStatus; place: string }>();
      const put = (id: string, status: TeamStatus, place: string) => {
        const rank: Record<TeamStatus, number> = { ausente: 4, doc: 3, obra: 2, patio: 2, sem: 0 };
        const cur = st.get(id);
        if (!cur || rank[status] > rank[cur.status]) st.set(id, { status, place });
      };
      for (const a of dayQ.data.al) {
        const cl = a.works?.clients?.name ?? a.works?.name ?? "—";
        const isPatio = cl.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim() === "PATIO";
        put(a.collaborator_id, isPatio ? "patio" : "obra", isPatio ? "Pátio" : cl);
      }
      const ABS_LABEL: Record<string, string> = { folga: "Folga", ferias: "Férias", atestado: "Atestado", medico: "Atestado", afastado: "Afastado", licenca: "Licença", falta: "Falta", abono: "Abono" };
      for (const e of dayQ.data.box) {
        const k = String(e.box_key ?? "");
        if (ABS_LABEL[k]) put(e.collaborator_id, "ausente", ABS_LABEL[k]!);
        else if (k === "aso" || k === "personalizada" || k.startsWith("integracao") || k.startsWith("treinamento")) put(e.collaborator_id, "doc", k === "aso" ? "ASO" : k.startsWith("integracao") ? "Integração" : "Treinamento");
      }
      for (const a of dayQ.data.ap) put(a.collaborator_id, "doc", TYPE_LABEL[a.type] ?? "Agendamento");
      for (const o of dayQ.data.off) put(o.collaborator_id, "ausente", "Folga");
      for (const v of dayQ.data.vac) put(v.collaborator_id, "ausente", "Férias");
      for (const m of dayQ.data.med) put(m.collaborator_id, "ausente", "Atestado");
      const cLabel = new Map(CONTRACT.map(([k, l]) => [k, l]));
      for (const c of active) {
        const x = st.get(c.id) ?? { status: "sem" as TeamStatus, place: "Sem escala" };
        team.push({ id: c.id, name: c.full_name, status: x.status, place: x.status === "ausente" ? "Ausente" : x.status === "doc" ? "Treinamento / ASO / Integração" : x.place, detail: x.place,
          fn: (c.position_id && posName.get(c.position_id)) || "Sem função", contract: cLabel.get(c.contract_type ?? "efetivo") ?? "Efetivo" });
      }
    }

    return {
      team,
      total: active.length, contract, hired, notice: notice.map((c: any) => ({ name: c.full_name as string, end: c.notice_end as string | null })).sort((a: any, b: any) => byName(a.name, b.name)),
      absParts, absAll, absSeries, absToday, apTypes, apTotal: ap.length, apDone, apLate, open, vagas, filled, aso,
    };
  }, [cadQ.data, absQ.data, apQ.data, docsQ.data, dayQ.data, R.from, R.to, today, mFrom, mTo, qFrom, qTo]);

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
        <div className="grid gap-3 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:grid-rows-[13.25rem_minmax(0,1fr)_minmax(0,1fr)]">
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

          <OverviewCard title="Contratações" to="/demandas/contratacoes" linkLabel="Abrir Contratações" hint="Vagas das solicitações de contratação (canceladas fora): atendidas e a atender" className="min-h-0">
            {(() => {
              const tot = d.filled + d.vagas;
              return (
                <div className="grid grid-cols-2 items-center gap-3">
                  <div className="min-w-0 space-y-2">
                    <div>
                      <div className="font-display text-3xl font-semibold leading-none tabular-nums"><CountUp value={d.vagas} /></div>
                      <p className="text-[11px] text-muted-foreground">a atender · {d.open.length} {d.open.length === 1 ? "solicitação" : "solicitações"}</p>
                    </div>
                    <div>
                      <div className="font-display text-xl font-semibold leading-none tabular-nums"><CountUp value={d.filled} /></div>
                      <p className="text-[11px] text-muted-foreground">atendidas</p>
                    </div>
                    <div className="flex flex-wrap gap-[3px]" aria-hidden="true">
                      {Array.from({ length: Math.min(tot, 24) }, (_, i) => <span key={i} className={cn("tile-snap h-2 w-2 rounded-[2px]", i < Math.round((d.filled / Math.max(1, tot)) * Math.min(tot, 24)) ? "bg-foreground" : "border border-dashed border-border bg-muted/40")} style={{ animationDelay: `${i * 30}ms` }} />)}
                    </div>
                  </div>
                  <Donut frac={tot ? d.filled / tot : 0} center={tot ? `${Math.round((d.filled / tot) * 100)}%` : "—"} sub="atendidas" size="h-36 w-36" />
                </div>
              );
            })()}
          </OverviewCard>

          <OverviewCard title="ASO dos ativos" to="/consulta" linkLabel="Abrir Consulta" hint={`Situação do ASO de cada colaborador ativo hoje (vencendo = próximos ${DOC_WARN_DAYS} dias)`} className="min-h-0" bodyClassName="flex min-h-0 flex-col justify-center">
            {(() => {
              const parts = [
                { label: "Em dia", n: d.aso.ok, cls: "stroke-foreground", dot: "bg-foreground" },
                { label: "Vencendo", n: d.aso.soon, cls: "stroke-foreground/55", dot: "bg-foreground/55" },
                { label: "Vencidos", n: d.aso.late, cls: "stroke-destructive/70", dot: "bg-destructive/70" },
                { label: "Sem ASO", n: d.aso.none, cls: "stroke-foreground/15", dot: "bg-foreground/15" },
              ];
              return (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <div className="space-y-1 text-[11px]">
                    {parts.map((x) => (
                      <div key={x.label} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 shrink-0 rounded-full", x.dot)} /><span className="w-[3.9rem] text-muted-foreground">{x.label}</span><b className="tabular-nums"><CountUp value={x.n} /></b></div>
                    ))}
                  </div>
                  <AsoArc parts={parts} total={d.total} />
                </div>
              );
            })()}
          </OverviewCard>

          <OverviewCard title={`Treinamentos por dia — ${MONTHS[Number(ym.slice(5, 7)) - 1]}`} to="/documentos/agendamentos" linkLabel="Abrir Agendamentos"
            hint="Pessoas em treinamento em cada dia do mês (realizados e agendados; cancelados fora). Clique num dia para ver só ele." className="min-h-0 pb-6 md:col-span-2 xl:col-span-2 xl:col-start-3 xl:row-start-2" bodyClassName="min-h-0">
            <div className="h-full min-h-0" onClick={(e) => e.preventDefault()}>
              {trQ.data ? <TrainingTiles rows={trQ.data} from={mFrom} to={mTo} today={today} /> : null}
            </div>
          </OverviewCard>
          <OverviewCard dark title={`Equipe — ${day === today ? "hoje" : brDay(day)}`} to="/colaboradores" linkLabel="Abrir Colaboradores"
            hint="Um círculo por colaborador ativo, na cor da situação do dia. Troque o agrupamento para ver as pessoas se reorganizarem; clique num grupo para destacá-lo."
            className="min-h-0 md:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-2" bodyClassName="flex min-h-0 flex-col">
            {dayQ.data ? <TeamMosaic dark people={d.team} title={`${d.team.length} colaboradores ativos · ${single ? brDay(day) : "hoje"}`} /> : null}
          </OverviewCard>
          <OverviewCard title={`Ausências — ${pLabel}`} to="/ausencias" linkLabel="Abrir Ausências" hint="Pessoas diferentes com folga, férias, atestado ou falta no período (quadros da Programação + Ausências). Clique numa fatia para ver as pessoas." className="min-h-0 xl:col-start-3 xl:row-start-3" bodyClassName="flex min-h-0 flex-col">
            <Pie3D total={d.absAll} totalLabel="pessoas ausentes" parts={d.absParts} unit={["pessoa", "pessoas"]} compact />
          </OverviewCard>

          <OverviewCard title="Ausentes por dia" to="/ausencias" linkLabel="Abrir Ausências" hint="Pessoas ausentes em cada dia do mês (folga, férias, atestado ou falta)" className="min-h-0 pb-6 xl:col-start-4 xl:row-start-3" bodyClassName="flex min-h-0 flex-col">
            <div className="flex items-baseline gap-2"><Big value={d.absToday} /><p className="text-xs text-muted-foreground">ausentes hoje · média {Math.round(d.absSeries.filter((s) => s.value).reduce((a, s) => a + s.value, 0) / Math.max(1, d.absSeries.filter((s) => s.value).length))} por dia</p></div>
            <LineArea height="h-24 lg:h-auto lg:min-h-0 lg:flex-1" className="mt-2 lg:min-h-[70px] lg:flex-1" data={d.absSeries.map((x) => ({ label: x.label, a: x.value, tip: x.label }))} format={(p) => `${p.a} ${p.a === 1 ? "ausente" : "ausentes"}`} />
          </OverviewCard>

        </div>
      )}
    </div>
    </FitScreen>
  );
}

/**
 * Treinamentos em quadradinhos, como o quadro de RDOs: cada coluna = dia do mês, cada quadradinho = pessoas em treinamento
 * (escuro = realizado, médio = agendado, contorno vermelho suave = agendado em dia passado). Clicar num dia mostra o resumo dele.
 */
function TrainingTiles({ rows, from, to, today, dark }: { rows: any[]; from: string; to: string; today: string; dark?: boolean }) {
  const K = dark
    ? { done: "bg-background", sched: "bg-background/45", empty: "border border-dashed border-background/25 bg-background/5", sel: "bg-background/10 ring-1 ring-background/30", now: "ring-1 ring-background/40", mut: "text-background/60", line: "border-background/15", track: "bg-background/15" }
    : { done: "bg-foreground", sched: "bg-foreground/45", empty: "border border-dashed border-border bg-muted/40", sel: "bg-muted ring-1 ring-border", now: "ring-1 ring-foreground/30", mut: "text-muted-foreground", line: "border-border", track: "bg-muted" };
  const [sel, setSel] = useState<number | null>(null);
  const days = daysBetween(from, to);
  const cols = days.map((x) => {
    const list = rows.filter((r) => r.scheduled_date === x);
    const done = list.filter((r) => r.status === "realizado").length;
    return { key: x, label: String(Number(x.slice(8, 10))), title: brDay(x), list, done, sched: list.length - done, late: x < today ? list.length - done : 0 };
  });
  const top = Math.max(1, ...cols.map((c) => c.list.length));
  // Como o quadro de RDOs: os quadradinhos tracejados vão até o topo; o nº de linhas sai da altura do quadro.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gbox, setGbox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = gridRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setGbox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const colW = gbox.w ? (gbox.w - 3 * (cols.length - 1)) / cols.length : 20;
  const cell = Math.min(24, Math.max(6, colW - 4));
  const nRows = gbox.h ? Math.max(3, Math.floor((gbox.h - 24) / (cell + 3))) : 8;
  const per = Math.max(1, Math.ceil(top / nRows));
  const c0 = sel != null ? cols[sel] : undefined;
  const list = c0 ? c0.list : rows;
  const done = list.filter((r) => r.status === "realizado").length;
  const sched = list.length - done;
  const late = c0 ? c0.late : cols.reduce((a, c) => a + c.late, 0);
  const pct = (v: number) => (list.length ? `${((v / list.length) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
  const byTraining = new Map<string, number>();
  for (const r of list) { const n = r.trainings?.name ?? "—"; byTraining.set(n, (byTraining.get(n) ?? 0) + 1); }
  const topTr = [...byTraining.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const step = cols.length > 16 ? 2 : 1;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
      <div className="h-full min-h-0 min-w-0 flex-1">
        <div ref={gridRef} className="flex h-full items-end gap-[3px] overflow-hidden">
          {cols.map((col, ci) => {
            const f = Math.ceil(col.done / per), s = Math.ceil(col.sched / per);
            return (
              <button key={col.key} type="button" onClick={() => setSel(sel === ci ? null : ci)} title={`${col.title}: ${col.done} realizados, ${col.sched} agendados`}
                className={cn("flex flex-1 flex-col items-stretch justify-end gap-[3px] rounded-md p-[2px] transition-colors", ci === sel && K.sel, col.key === today && ci !== sel && K.now)}>
                {Array.from({ length: nRows }, (_, r) => {
                  const fromBottom = nRows - 1 - r;
                  const cls = fromBottom < f ? K.done
                    : fromBottom < f + s ? cn(K.sched, col.late && "ring-1 ring-destructive/60")
                    : K.empty;
                  return <span key={r} className={cn("ov-grow w-full shrink-0 rounded-[4px]", cls)} style={{ height: cell, animationDelay: `${ci * 25 + fromBottom * 15}ms` }} />;
                })}
                <span className={cn("mt-1 shrink-0 text-center text-[10px] tabular-nums", K.mut)}>{ci % step === 0 || ci === sel ? col.label : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={cn("flex w-full flex-col gap-3 border-t pt-3 md:w-52 md:border-l md:border-t-0 md:pl-5 md:pt-0", K.line)}>
        <div>
          <p className={cn("text-[10px] font-medium uppercase tracking-wider", K.mut)}>{c0 ? c0.title : "Resumo do mês"}</p>
          <p className="font-display text-3xl font-semibold leading-tight tabular-nums"><CountUp value={list.length} /></p>
          <p className={cn("text-[11px]", K.mut)}>treinamentos · {new Set(list.map((r) => r.collaborator_id)).size} pessoas</p>
        </div>
        <div className={cn("flex h-2 overflow-hidden rounded-full", K.track)}>
          <div className={cn("h-full transition-[width] duration-700", K.done)} style={{ width: list.length ? `${(done / list.length) * 100}%` : 0 }} />
          <div className={cn("h-full transition-[width] duration-700", K.sched)} style={{ width: list.length ? `${(sched / list.length) * 100}%` : 0 }} />
        </div>
        <div className="space-y-0.5 text-xs">
          {([[K.done, "Realizados", done], [K.sched, "Agendados", sched], ...(late > 0 ? [[cn(K.sched, "ring-1 ring-destructive/60"), "Atrasados", late]] : [])] as [string, string, number][]).map(([dot, l, v]) => (
            <div key={l} className="flex items-center gap-2 px-1 py-0.5">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", dot)} />
              <span className={cn("min-w-0 flex-1 truncate", K.mut)}>{l}</span>
              <span className="font-semibold tabular-nums">{v}</span>
              <span className={cn("w-11 text-right text-[10px] tabular-nums", K.mut)}>{pct(v)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-0.5 text-[11px]">
          {topTr.map(([n, v]) => <div key={n} className="flex justify-between gap-2"><span className={cn("truncate", K.mut)}>{n}</span><b className="tabular-nums">{v}</b></div>)}
        </div>
        <p className={cn("mt-auto text-[10px] leading-relaxed", K.mut)}>{c0 ? "Clique de novo para ver o mês" : "Clique num dia para ver só ele"}<br />1 quadradinho = {per} {per === 1 ? "pessoa" : "pessoas"}</p>
      </div>
    </div>
  );
}

/**
 * Meia-lua do ASO: arco dividido pelas situações (em dia, vencendo, vencidos, sem ASO), régua tracejada por fora
 * (traço a cada 5%, maior a cada 25%) e arco pontilhado por dentro; os trechos se desenham em sequência ao entrar.
 */
function AsoArc({ parts, total }: { parts: { label: string; n: number; cls: string }[]; total: number }) {
  const R = 60, CX = 90, CY = 88;
  const pt = (r: number, t: number) => { const a = Math.PI * (1 - t); return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const; };
  const arc = (r: number, t0: number, t1: number) => { const [x0, y0] = pt(r, t0), [x1, y1] = pt(r, t1); return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`; };
  const tot = Math.max(1, total);
  let acc = 0;
  const segs = parts.filter((p) => p.n > 0).map((p, i) => {
    const t0 = acc / tot; acc += p.n; const t1 = acc / tot;
    const g = 0.006;
    return { ...p, i, d: arc(R, Math.min(t0 + g, t1), Math.max(t0, t1 - g)), len: Math.PI * R * Math.max(0, t1 - t0 - 2 * g) };
  });
  const okPct = Math.round(((parts[0]?.n ?? 0) / tot) * 100);
  return (
    <div className="relative mx-auto w-full max-w-[230px]">
      <svg viewBox="0 0 180 100" className="w-full overflow-visible">
        {Array.from({ length: 21 }, (_, k) => {
          const t = k / 20, major = k % 5 === 0;
          const [x0, y0] = pt(R + 10, t), [x1, y1] = pt(R + (major ? 17 : 14), t);
          return <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={major ? 1.4 : 0.9} strokeLinecap="round" className={cn("ov-fade", major ? "stroke-foreground/50" : "stroke-foreground/25")} style={{ animationDelay: `${k * 25}ms` }} />;
        })}
        <path d={arc(R + 10, 0, 1)} fill="none" className="stroke-foreground/15" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
        <path d={arc(R, 0, 1)} fill="none" strokeWidth="11" className="stroke-muted" />
        {segs.map((sg) => (
          <path key={sg.label} d={sg.d} fill="none" strokeWidth="11" className={cn("ov-gauge", sg.cls)}
            style={{ strokeDasharray: `${sg.len} 400`, ["--ov-off" as string]: 0, strokeDashoffset: 0, animationDelay: `${150 + sg.i * 220}ms` }} />
        ))}
        <path d={arc(R - 12, 0, 1)} fill="none" className="stroke-foreground/25" strokeWidth="0.8" strokeDasharray="0.5 3" strokeLinecap="round" />
        <text x={CX - R - 4} y={CY + 10} textAnchor="middle" className="fill-muted-foreground text-[7px]">0%</text>
        <text x={CX + R + 4} y={CY + 10} textAnchor="middle" className="fill-muted-foreground text-[7px]">100%</text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="font-display text-2xl font-semibold leading-none tabular-nums"><CountUp value={`${okPct}%`} /></p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">em dia · {parts[0]?.n ?? 0} de {total}</p>
      </div>
    </div>
  );
}

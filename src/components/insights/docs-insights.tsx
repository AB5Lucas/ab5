/**
 * Blocos vivos da Documentação (Documentação e Agendamentos):
 * 1. Radar de vencimentos (60 dias) · 2. Bloqueados para o próximo dia útil · 3. Turmas se formando · 4. Prontidão por cliente.
 * Regras em lib/insights/docs.ts (mesmas de doc-status.ts / scheduling.ts). O contexto da Programação vem da mesma
 * consulta do quadro (["schedule-ctx", dia]), então abrir a Programação depois não relê tudo.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, GraduationCap, Radar, ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { fetchScheduleContext, todayISO } from "@/lib/scheduling";
import { nextBusinessDay } from "@/lib/schedule-alerts";
import {
  addDaysIso, blockedPeople, clientReadiness, currentDocs, DOC_KIND_LABEL, DOC_KIND_TAB, expiryRadar, formingClasses,
} from "@/lib/insights/docs";
import { CountUp } from "@/components/count-up";
import { BigNumber, InsightCard, InsightRow, InsightStrip, Ring, Timeline } from "@/components/insights";
import { cn } from "@/lib/utils";

const REFRESH = 2 * 60_000;
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ringTone = (pct: number) => (pct >= 0.9 ? "text-success" : pct >= 0.7 ? "text-warning" : "text-destructive");

/** Próximo dia útil (pula fim de semana e feriados cadastrados). */
function useNextBusinessDay(today: string) {
  return useQuery({
    queryKey: ["insights", "holidays", today],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("date").gte("date", today).lte("date", addDaysIso(today, 40)).order("date");
      if (error) throw error;
      return nextBusinessDay(today, new Set((data ?? []).map((h) => h.date)));
    },
  });
}

export function DocsInsights() {
  const navigate = useNavigate();
  const today = todayISO();
  const next = useNextBusinessDay(today);
  const day = next.data;
  const ctx = useQuery({
    queryKey: ["schedule-ctx", day],
    enabled: !!day,
    staleTime: REFRESH,
    refetchInterval: 5 * 60_000,
    queryFn: () => fetchScheduleContext(day!),
  });
  // Alocações dos últimos 30 dias (prontidão) e do próximo dia útil (bloqueados).
  const allocs = useQuery({
    queryKey: ["insights", "docs-allocs", today, day],
    enabled: !!day,
    staleTime: REFRESH,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const scheds = await fetchAll<{ id: string; schedule_date: string }>((a, b) => supabase.from("daily_schedules").select("id, schedule_date")
        .gte("schedule_date", addDaysIso(today, -30)).lte("schedule_date", day!).order("id").range(a, b));
      if (!scheds.length) return { recent: [], next: [] };
      const dateOf = new Map(scheds.map((s) => [s.id, s.schedule_date]));
      const rows = await fetchAll<{ schedule_id: string; collaborator_id: string; work_id: string }>((a, b) => supabase.from("daily_allocations")
        .select("schedule_id, collaborator_id, work_id").in("schedule_id", scheds.map((s) => s.id)).order("id").range(a, b));
      return {
        recent: rows.filter((r) => (dateOf.get(r.schedule_id) ?? "") <= today),
        next: rows.filter((r) => dateOf.get(r.schedule_id) === day),
      };
    },
  });
  const appts = useQuery({
    queryKey: ["insights", "docs-classes", today],
    staleTime: REFRESH,
    refetchInterval: REFRESH,
    queryFn: () => fetchAll<{ training_id: string | null; scheduled_date: string; collaborator_id: string }>((a, b) => supabase.from("appointments")
      .select("training_id, scheduled_date, collaborator_id").eq("type", "treinamento").eq("status", "agendado").gte("scheduled_date", today)
      .order("scheduled_date").order("id").range(a, b)),
  });

  const c = ctx.data;
  const trainingName = useMemo(() => new Map((c?.trainings ?? []).map((t) => [t.id, t.name])), [c]);
  const radar = useMemo(() => {
    if (!c) return null;
    const clientName = new Map<string, string>();
    for (const w of c.works) if (w.client_id && w.clients?.name) clientName.set(w.client_id, w.clients.name);
    const people = new Map(c.collaborators.map((p) => [p.id, p.full_name]));
    return expiryRadar(currentDocs({ people, asos: c.asos, trainings: c.collabTrainings, integrations: c.integrations, trainingName, clientName }), today, 60);
  }, [c, today, trainingName]);
  const blocked = useMemo(() => (c && day && allocs.data ? blockedPeople(c, allocs.data.next, day) : null), [c, day, allocs.data]);
  const ready = useMemo(() => (c && allocs.data ? clientReadiness(c, allocs.data.recent, today) : null), [c, allocs.data, today]);
  const classes = useMemo(() => formingClasses(appts.data ?? [], today, trainingName), [appts.data, today, trainingName]);

  const [pick, setPick] = useState<string | null>(null);
  const picked = radar?.days.find((d) => d.date === pick && d.count) ?? null;
  const blockedPeopleCount = new Set((blocked ?? []).map((b) => b.collaboratorId)).size;
  const openRelease = (cliente?: string | null, busca?: string) =>
    navigate({ to: "/agendamentos", search: { tab: "liberacao", ...(cliente ? { cliente } : {}), ...(busca ? { busca } : {}) } });

  return (
    <InsightStrip id="documentacao" summary={radar ? `${radar.week} vencem em 7 dias · ${blockedPeopleCount} bloqueados para ${day ? br(day) : "amanhã"}` : undefined}>
      <InsightCard title="Radar de vencimentos · 60 dias" icon={<Radar />} loading={ctx.isLoading || next.isLoading} error={ctx.isError}
        tone={radar && radar.week > 0 ? "warn" : "default"}
        hint="ASO, treinamentos e integrações vigentes de quem está ativo (documento mais recente de cada pessoa). Bolinha = dia, tamanho = quantos vencem, cor: vermelho até 7 dias, laranja até 30, verde depois. Clique no dia para ver quem vence.">
        {radar && (
          <>
            <BigNumber label={`vencem em 60 dias · ${radar.week} em 7 dias${radar.expired ? ` · ${radar.expired} já vencidos` : ""}`}>
              <CountUp value={radar.total} />
            </BigNumber>
            <Timeline days={radar.days.map((d) => ({ date: d.date, count: d.count, tone: d.tone, title: `${br(d.date)}: ${d.count} ${d.count === 1 ? "documento" : "documentos"}` }))}
              selected={pick} onPick={(d) => setPick((p) => (p === d ? null : d))} />
            {picked ? (
              <div className="space-y-0.5 border-t pt-1">
                <div className="text-[11px] font-medium">Vencem em {br(picked.date)}</div>
                {picked.docs.slice(0, 6).map((d) => (
                  <InsightRow key={d.key} title={`Abrir ${DOC_KIND_LABEL[d.kind]} de ${d.name}`}
                    onClick={() => navigate({ to: "/agendamentos", search: { tab: DOC_KIND_TAB[d.kind], busca: d.name } })}>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="shrink-0 text-muted-foreground">{d.label}</span>
                  </InsightRow>
                ))}
                {picked.docs.length > 6 && <div className="text-[11px] text-muted-foreground">+{picked.docs.length - 6} no dia</div>}
              </div>
            ) : <p className="text-[11px] text-muted-foreground">Clique numa bolinha para ver quem vence.</p>}
          </>
        )}
      </InsightCard>

      <InsightCard title={`Bloqueados para ${day ? br(day) : "o próximo dia útil"}`} icon={<ShieldAlert />}
        loading={ctx.isLoading || allocs.isLoading || next.isLoading} error={ctx.isError || allocs.isError}
        tone={blockedPeopleCount ? "alert" : "ok"} pulse={blockedPeopleCount > 0}
        onClick={() => openRelease(blocked?.[0]?.clientId)}
        hint="Escalados na Programação do próximo dia útil com ASO, treinamento exigido pelo cliente ou integração vencidos/ausentes (mesma regra da Programação; aceite na Conferência libera). Clique para abrir a Liberação por cliente.">
        {blocked && (
          <>
            <BigNumber label={blockedPeopleCount === 1 ? "pessoa" : "pessoas"} className={blockedPeopleCount ? "text-destructive" : "text-success"}>
              <CountUp value={blockedPeopleCount} />
            </BigNumber>
            {blocked.length ? (
              <div className="space-y-0.5">
                {blocked.slice(0, 4).map((b) => (
                  <InsightRow key={`${b.collaboratorId}|${b.workName}`} title={`${b.workName}: ${b.reasons.join("; ")}`} onClick={() => openRelease(b.clientId, b.name)}>
                    <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                    <span className="max-w-[55%] shrink-0 truncate text-muted-foreground">{b.clientName} · {b.reasons[0]}</span>
                  </InsightRow>
                ))}
                {blocked.length > 4 && <div className="text-[11px] text-muted-foreground">+{blocked.length - 4} na Liberação por cliente</div>}
              </div>
            ) : <p className="text-xs text-muted-foreground">{allocs.data?.next.length ? "Todos os escalados estão liberados." : "Programação do dia ainda sem escalados."}</p>}
          </>
        )}
      </InsightCard>

      <InsightCard title="Turmas se formando" icon={<GraduationCap />} loading={appts.isLoading || ctx.isLoading} error={appts.isError}
        tone={classes.length ? "info" : "default"}
        onClick={() => navigate({ to: "/documentos/agendamentos", search: {} })}
        hint="Treinamentos com 2 ou mais pessoas agendadas no mesmo dia (de hoje em diante). Clique numa turma para abrir os Agendamentos filtrados pelo treinamento e dia.">
        <BigNumber label={classes.length === 1 ? "turma agendada" : "turmas agendadas"}><CountUp value={classes.length} /></BigNumber>
        <div className="space-y-0.5">
          {classes.slice(0, 4).map((g) => (
            <InsightRow key={`${g.trainingId}|${g.date}`} title={`${g.label} em ${br(g.date)}: ${g.count} pessoas`}
              onClick={() => navigate({ to: "/documentos/agendamentos", search: { dia: g.date, treinamento: g.trainingId } })}>
              <CalendarClock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{g.label} em {br(g.date)}</span>
              <b className="shrink-0 tabular-nums">{g.count} {g.count === 1 ? "pessoa" : "pessoas"}</b>
            </InsightRow>
          ))}
          {!classes.length && <p className="text-xs text-muted-foreground">Nenhuma turma com 2+ pessoas agendada.</p>}
        </div>
      </InsightCard>

      <InsightCard title="Prontidão por cliente · 30 dias" icon={<ShieldCheck />} loading={ctx.isLoading || allocs.isLoading} error={ctx.isError || allocs.isError}
        tone={ready?.some((r) => r.pct < 0.7) ? "warn" : "ok"}
        hint="Para cada cliente: da equipe que trabalhou nele nos últimos 30 dias (Programação), % que está liberada hoje (ASO válido, treinamentos exigidos pelo cliente e integração válida). Clique no anel para abrir a Liberação do cliente.">
        {ready && (ready.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {ready.slice(0, 6).map((r) => (
              <button key={r.clientId} type="button" onClick={(e) => { e.stopPropagation(); openRelease(r.clientId); }}
                title={`${r.clientName}: ${r.released} de ${r.team} liberados${r.pending.length ? `\nPendentes: ${r.pending.slice(0, 8).join(", ")}${r.pending.length > 8 ? "…" : ""}` : ""}`}
                className="flex min-w-0 flex-col items-center gap-0.5 rounded p-0.5 hover:bg-muted">
                <Ring value={r.pct} size={40} className={ringTone(r.pct)}>{Math.round(r.pct * 100)}%</Ring>
                <span className={cn("w-full truncate text-center text-[10px]", r.pct < 0.7 && "font-medium")}>{r.clientName}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">Sem escalações nos últimos 30 dias.</p>)}
      </InsightCard>
    </InsightStrip>
  );
}

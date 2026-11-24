/**
 * Blocos vivos de Atividades (Programação, Serviços e Relatório Diário), sempre do dia aberto na página:
 * 13. Pulso do dia · 14. RDOs do dia · 15. Distribuição pendente · 16. Dias seguidos sem folga.
 * Cadastros (serviços, clientes, colaboradores) vêm do cache de 5 min (lib/cadastro-cache.ts); os dados do dia são
 * relidos a cada 2 min e depois de qualquer gravação (["insights"] no MutationCache).
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Activity, BedDouble, ClipboardCheck, Split } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { readCadastro } from "@/lib/cadastro-cache";
import { readClientsCadastro, readWorksCadastro } from "@/lib/schedule-alerts.data";
import { useServiceDistribution } from "@/hooks/use-service-distribution";
import { useWorkScope } from "@/hooks/use-work-scope";
import { addDaysIso, shortBR } from "@/lib/insights/dates";
import { absencesByDay, dayPulse, PULSE_BOX_LABEL, PULSE_LABEL, rdoTiles, restStreaks, type PulseKey, type RdoTile } from "@/lib/insights/day";
import { RDO_STATUS_LABEL } from "@/lib/rdo";
import { todayISO } from "@/lib/scheduling";
import { CountUp } from "@/components/count-up";
import { BigNumber, InsightCard, InsightRow, InsightStrip, Legend, StackedBar } from "@/components/insights";
import { cn } from "@/lib/utils";

const REFRESH = 2 * 60_000;
const STREAK_DAYS = 21;
const PULSE_CLS: Record<PulseKey, string> = {
  obra: "bg-primary", compromisso: "bg-info", folga: "bg-success", atestado: "bg-destructive", ferias: "bg-warning", outros: "bg-muted-foreground/50",
};
const TILE_CLS: Record<RdoTile["status"], string> = {
  final: "bg-success hover:bg-success/80",
  draft: "bg-warning hover:bg-warning/80",
  none: "bg-muted-foreground/25 hover:bg-muted-foreground/40",
};
const TILE_LABEL: Record<RdoTile["status"], string> = { final: "RDO finalizado", draft: "RDO em rascunho", none: "Sem RDO" };

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** Rola até o quadro da Programação cujo título começa com um dos rótulos (sem mexer no quadro) e destaca por um instante. */
function scrollToBox(labels: string[] | null) {
  if (typeof document === "undefined") return false;
  const heads = Array.from(document.querySelectorAll<HTMLElement>("section > header h2"));
  const h = labels ? heads.find((el) => labels.some((l) => (el.textContent ?? "").trim().toUpperCase().startsWith(l))) : heads[0];
  const sec = h?.closest("section");
  if (!sec) return false;
  sec.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  sec.classList.add("insight-flash");
  setTimeout(() => sec.classList.remove("insight-flash"), 1600);
  return true;
}

type Block = "pulse" | "rdo" | "distribution" | "streak";

export function DayInsights({ date, id, blocks = ["pulse", "rdo", "distribution", "streak"], onOpenRdo, onOpenClient }: {
  date: string;
  /** Página (lembra se a faixa está recolhida). */
  id: string;
  blocks?: Block[] | undefined;
  /** Relatório Diário: abre o RDO na própria página. */
  onOpenRdo?: ((workId: string) => void) | undefined;
  /** Serviços: abre o cliente na própria página. */
  onOpenClient?: ((clientId: string) => void) | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const scope = useWorkScope();
  const from = addDaysIso(date, -(STREAK_DAYS - 1));
  const day = useQuery({
    queryKey: ["insights", "day", date],
    staleTime: 60_000,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [scheds, works, clients, people, appts, vacations, medical, daysOff, rdos] = await Promise.all([
        fetchAll<{ id: string; schedule_date: string }>((a, b) => supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", from).lte("schedule_date", date).order("id").range(a, b)),
        readWorksCadastro(qc) as Promise<{ id: string; name: string; client_id: string | null; active: boolean }[]>,
        readClientsCadastro(qc) as Promise<{ id: string; name: string }[]>,
        readCadastro(qc, "collaborators:insights", () => fetchAll<{ id: string; full_name: string }>((a, b) => supabase.from("collaborators").select("id, full_name").order("id").range(a, b))),
        fetchAll<{ collaborator_id: string }>((a, b) => supabase.from("appointments").select("collaborator_id").eq("scheduled_date", date).in("status", ["agendado", "realizado"]).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; start_date: string; end_date: string }>((a, b) => supabase.from("vacations").select("collaborator_id, start_date, end_date").lte("start_date", date).gte("end_date", from).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; start_date: string; end_date: string }>((a, b) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lte("start_date", date).gte("end_date", from).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; date: string; end_date: string | null }>((a, b) => supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date).or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`).order("id").range(a, b)),
        fetchAll<{ id: string; work_id: string; status: string }>((a, b) => supabase.from("rdos").select("id, work_id, status").eq("report_date", date).order("id").range(a, b)),
      ]);
      const sched = scheds.find((s) => s.schedule_date === date) ?? null;
      const dateOf = new Map(scheds.map((s) => [s.id, s.schedule_date]));
      const [allocs, boxes] = await Promise.all([
        scheds.length ? fetchAll<{ schedule_id: string; collaborator_id: string; work_id: string }>((a, b) => supabase.from("daily_allocations")
          .select("schedule_id, collaborator_id, work_id").in("schedule_id", scheds.map((s) => s.id)).order("id").range(a, b)) : Promise.resolve([]),
        sched ? fetchAll<{ collaborator_id: string; box_key: string }>((a, b) => supabase.from("daily_status_entries").select("collaborator_id, box_key").eq("schedule_id", sched.id).order("id").range(a, b)) : Promise.resolve([]),
      ]);
      return { sched, dateOf, allocs, boxes, works, clients, people, appts, vacations, medical, daysOff, rdos };
    },
  });
  const dist = useServiceDistribution(blocks.includes("distribution") ? date : undefined);

  const d = day.data;
  const workInfo = useMemo(() => {
    const clientName = new Map((d?.clients ?? []).map((c) => [c.id, c.name]));
    return new Map((d?.works ?? []).map((w) => [w.id, { name: w.name, clientName: w.client_id ? clientName.get(w.client_id) ?? "" : "", client_id: w.client_id }]));
  }, [d]);
  const personName = useMemo(() => new Map((d?.people ?? []).map((p) => [p.id, p.full_name])), [d]);
  const todayAllocs = useMemo(() => (d ? d.allocs.filter((a) => d.dateOf.get(a.schedule_id) === date) : []), [d, date]);
  const pulse = useMemo(() => (d ? dayPulse({
    allocations: todayAllocs, boxes: d.boxes, appointments: d.appts,
    vacations: d.vacations.filter((v) => v.start_date <= date && v.end_date >= date),
    medical: d.medical.filter((v) => v.start_date <= date && v.end_date >= date),
    daysOff: d.daysOff.filter((o) => o.date <= date && (o.end_date ?? o.date) >= date),
  }) : null), [d, todayAllocs, date]);
  const tiles = useMemo(() => (d ? rdoTiles(todayAllocs.filter((a) => scope.allowWork({ id: a.work_id, client_id: workInfo.get(a.work_id)?.client_id ?? null })), d.rdos, workInfo) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, todayAllocs, workInfo, scope.allowWork]);
  const streaks = useMemo(() => {
    if (!d) return [];
    const worked = new Map<string, Set<string>>();
    for (const a of d.allocs) { const dt = d.dateOf.get(a.schedule_id)!; worked.set(dt, (worked.get(dt) ?? new Set()).add(a.collaborator_id)); }
    const absent = absencesByDay(from, date, [
      ...d.vacations.map((v) => ({ collaborator_id: v.collaborator_id, start: v.start_date, end: v.end_date })),
      ...d.medical.map((v) => ({ collaborator_id: v.collaborator_id, start: v.start_date, end: v.end_date })),
      ...d.daysOff.map((v) => ({ collaborator_id: v.collaborator_id, start: v.date, end: v.end_date })),
    ]);
    return restStreaks(date, worked, absent, 6, STREAK_DAYS);
  }, [d, date, from]);
  const pendingClients = useMemo(() => {
    const name = new Map((d?.clients ?? []).map((c) => [c.id, c.name]));
    return (dist.data?.pendingClientIds ?? []).map((id) => ({ id, name: name.get(id) ?? "Cliente" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [dist.data, d]);

  const onPlanner = pathname.startsWith("/programacao/diaria");
  const openBoard = (k: PulseKey | null) => {
    if (onPlanner && scrollToBox(k ? PULSE_BOX_LABEL[k] ?? null : null)) return;
    navigate({ to: "/programacao/diaria", search: { date } });
  };
  const openRdo = (workId: string) => (onOpenRdo ? onOpenRdo(workId) : navigate({ to: "/externo/relatorio-diario", search: { obra: workId, data: date } }));
  const openClient = (clientId: string) => (onOpenClient ? onOpenClient(clientId) : navigate({ to: "/programacao/servicos", search: { data: date, cliente: clientId } }));

  const done = tiles.filter((t) => t.status === "final").length;
  const drafts = tiles.filter((t) => t.status === "draft").length;
  const missing = tiles.length - done - drafts;
  const long = streaks.filter((s) => s.days >= 7).length;
  const parts = pulse ? (Object.keys(PULSE_LABEL) as PulseKey[]).map((k) => ({ key: k, label: PULSE_LABEL[k], value: pulse.counts[k], className: PULSE_CLS[k] })) : [];
  const isPast = date < todayISO();

  return (
    <InsightStrip id={`atividades-${id}`} title={`Painel do dia ${shortBR(date)}`}
      summary={pulse ? `${pulse.total} na programação · RDOs ${done}/${tiles.length} · ${pendingClients.length} clientes sem distribuição` : undefined}>
      {blocks.includes("pulse") && (
        <InsightCard title="Pulso do dia" icon={<Activity />} loading={day.isLoading} error={day.isError}
          onClick={() => openBoard(null)}
          hint="Todos que aparecem na Programação do dia (obras e quadros, mais agendamentos e ausências cadastradas), cada pessoa numa situação só: obra > treinamento/integração/ASO > férias > atestado > folga > outros quadros. Clique numa cor para ir ao quadro.">
          {pulse && (
            <>
              <BigNumber label={d?.sched ? "na programação" : "programação não criada"}><CountUp value={pulse.total} /></BigNumber>
              <StackedBar parts={parts} onPick={(k) => openBoard(k as PulseKey)} />
              <Legend items={parts.filter((p) => p.value).map((p) => ({ label: p.label, className: p.className, value: p.value }))} />
            </>
          )}
        </InsightCard>
      )}
      {blocks.includes("rdo") && (
        <InsightCard title="RDOs do dia" icon={<ClipboardCheck />} loading={day.isLoading} error={day.isError}
          tone={isPast && missing ? "warn" : done === tiles.length && tiles.length ? "ok" : "default"}
          hint="Um quadradinho por serviço com equipe escalada no dia: verde = RDO finalizado/aprovado, amarelo = rascunho, cinza = sem RDO. Clique para abrir o RDO do serviço.">
          <BigNumber label={`de ${tiles.length} finalizados · ${drafts} rascunho · ${missing} sem RDO`}><CountUp value={done} /></BigNumber>
          <div className="flex flex-wrap gap-1">
            {tiles.map((t) => (
              <button key={t.workId} type="button" onClick={(e) => { e.stopPropagation(); openRdo(t.workId); }}
                title={`${t.clientName ? `${t.clientName} · ` : ""}${t.name}\n${t.people} ${t.people === 1 ? "pessoa" : "pessoas"} · ${t.rdoStatus ? RDO_STATUS_LABEL[t.rdoStatus] ?? t.rdoStatus : TILE_LABEL.none}`}
                aria-label={`${t.name}: ${TILE_LABEL[t.status]}`}
                className={cn("h-4 w-4 rounded-sm transition-transform hover:scale-125", TILE_CLS[t.status])} />
            ))}
            {!tiles.length && <p className="text-xs text-muted-foreground">Nenhum serviço com equipe no dia.</p>}
          </div>
        </InsightCard>
      )}
      {blocks.includes("distribution") && (
        <InsightCard title="Distribuição pendente" icon={<Split />} loading={dist.isLoading} error={dist.isError}
          tone={pendingClients.length ? "warn" : "ok"}
          hint="Clientes com mais de um serviço ativo e gente escalada no dia ainda sem serviço escolhido na aba Serviços (mesma regra do aviso do menu; ausentes e quem está em agendamento não contam). Clique para abrir o cliente na aba Serviços.">
          <BigNumber label={pendingClients.length === 1 ? "cliente sem distribuição" : "clientes sem distribuição"} className={pendingClients.length ? "text-orange-600 dark:text-orange-400" : "text-success"}>
            <CountUp value={pendingClients.length} />
          </BigNumber>
          <div className="space-y-0.5">
            {pendingClients.slice(0, 5).map((c) => (
              <InsightRow key={c.id} onClick={() => openClient(c.id)} title={`Abrir ${c.name} na aba Serviços`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
              </InsightRow>
            ))}
            {pendingClients.length > 5 && <div className="text-[11px] text-muted-foreground">+{pendingClients.length - 5} clientes</div>}
            {!pendingClients.length && <p className="text-xs text-muted-foreground">Todos distribuídos nos serviços.</p>}
          </div>
        </InsightCard>
      )}
      {blocks.includes("streak") && (
        <InsightCard title="Dias seguidos sem folga" icon={<BedDouble />} loading={day.isLoading} error={day.isError}
          tone={long ? "alert" : streaks.length ? "warn" : "ok"} pulse={long > 0}
          onClick={() => navigate({ to: "/ausencias/folgas" })}
          hint={`Escalados em obra no dia que estão há 6 ou mais dias seguidos na Programação sem folga, férias ou atestado (lê até ${STREAK_DAYS} dias para trás; dia sem programação interrompe). Pulsa com 7 ou mais. Clique para lançar folgas.`}>
          <BigNumber label={`com 6+ dias${long ? ` · ${long} com 7+` : ""}`} className={long ? "text-destructive" : undefined}><CountUp value={streaks.length} /></BigNumber>
          <div className="space-y-0.5">
            {streaks.slice(0, 5).map((s) => (
              <InsightRow key={s.collaboratorId} title={`Escalado todos os dias desde ${shortBR(s.since)}`}>
                <span className="min-w-0 flex-1 truncate">{personName.get(s.collaboratorId) ?? "—"}</span>
                <b className={cn("shrink-0 tabular-nums", s.days >= 7 && "text-destructive")}>{s.days >= STREAK_DAYS ? `${STREAK_DAYS}+` : s.days} d</b>
              </InsightRow>
            ))}
            {streaks.length > 5 && <div className="text-[11px] text-muted-foreground">+{streaks.length - 5} pessoas</div>}
            {!streaks.length && <p className="text-xs text-muted-foreground">Ninguém com 6+ dias seguidos.</p>}
          </div>
        </InsightCard>
      )}
    </InsightStrip>
  );
}

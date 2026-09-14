import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { addDays, todayISO } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/programacao/semanal")({
  head: () => ({
    meta: [
      { title: "Overview Semanal | Programação Operacional" },
      { name: "description", content: "Resumo de segunda a domingo com programados, confirmados e ausências." },
      { property: "og:title", content: "Overview Semanal | Programação Operacional" },
      { property: "og:description", content: "Resumo de segunda a domingo com programados, confirmados e ausências." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  in_progress: "Em andamento",
  finalized: "Finalizada",
};

function mondayOf(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const diff = (d.getDay() + 6) % 7;
  return addDays(iso, -diff);
}

function Page() {
  const [start, setStart] = useState(() => mondayOf(todayISO()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const end = days[6];

  const q = useQuery({
    queryKey: ["weekly", start],
    queryFn: async () => {
      const [schedules, absVac, absMed, absOff, holidays, works] = await Promise.all([
        supabase.from("daily_schedules").select("id, schedule_date, status").gte("schedule_date", start).lte("schedule_date", end),
        supabase.from("vacations").select("collaborator_id, start_date, end_date").lte("start_date", end).gte("end_date", start),
        supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lte("start_date", end).gte("end_date", start),
        supabase.from("days_off").select("collaborator_id, date").gte("date", start).lte("date", end),
        supabase.from("holidays").select("date, name").gte("date", start).lte("date", end),
        supabase.from("works").select("id, code, name").eq("active", true).order("code"),
      ]);

      const scheduleList = schedules.data ?? [];
      const ids = scheduleList.map((s) => s.id);
      const { data: allocs } = ids.length
        ? await supabase
            .from("daily_allocations")
            .select("schedule_id, work_id, collaborator_id, confirmation_status, has_pending_requirement")
            .in("schedule_id", ids)
        : { data: [] as never[] };

      return {
        schedules: scheduleList,
        allocations: allocs ?? [],
        vacations: absVac.data ?? [],
        leaves: absMed.data ?? [],
        daysOff: absOff.data ?? [],
        holidays: holidays.data ?? [],
        works: works.data ?? [],
      };
    },
  });

  const data = q.data;

  const perDay = days.map((date) => {
    const schedule = data?.schedules.find((s) => s.schedule_date === date);
    const allocs = (data?.allocations ?? []).filter((a) => a.schedule_id === schedule?.id);
    const absences =
      (data?.vacations ?? []).filter((v) => v.start_date <= date && v.end_date >= date).length +
      (data?.leaves ?? []).filter((v) => v.start_date <= date && v.end_date >= date).length +
      (data?.daysOff ?? []).filter((v) => v.date === date).length;
    return {
      date,
      schedule,
      total: allocs.length,
      confirmed: allocs.filter((a) => a.confirmation_status === "confirmed").length,
      pending: allocs.filter((a) => a.has_pending_requirement).length,
      works: new Set(allocs.map((a) => a.work_id)).size,
      absences,
      holiday: (data?.holidays ?? []).find((h) => h.date === date)?.name ?? null,
      allocs,
    };
  });

  const weekTotal = perDay.reduce((s, d) => s + d.total, 0);
  const weekConfirmed = perDay.reduce((s, d) => s + d.confirmed, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview Semanal"
        description="Resumo de segunda a domingo com programados, confirmados, pendências e ausências."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setStart(addDays(start, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setStart(mondayOf(todayISO()))}>
              Semana atual
            </Button>
            <Button variant="outline" size="icon" onClick={() => setStart(addDays(start, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs uppercase text-muted-foreground">Alocações na semana</p>
          <p className="font-display text-2xl font-semibold">{weekTotal}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase text-muted-foreground">Confirmadas</p>
          <p className="font-display text-2xl font-semibold">{weekConfirmed}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase text-muted-foreground">Dias programados</p>
          <p className="font-display text-2xl font-semibold">{perDay.filter((d) => d.schedule).length} / 7</p>
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando semana…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {perDay.map((d) => {
            const label = new Date(d.date + "T12:00:00").toLocaleDateString("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
            });
            const isToday = d.date === todayISO();
            return (
              <div
                key={d.date}
                className={`panel space-y-2 p-4 ${isToday ? "ring-2 ring-primary" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-display text-sm font-semibold uppercase">{label}</p>
                  {d.schedule ? (
                    <Badge variant={d.schedule.status === "finalized" ? "default" : "secondary"}>
                      {STATUS_LABEL[d.schedule.status] ?? d.schedule.status}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Sem programação</Badge>
                  )}
                </div>
                {d.holiday && <p className="text-xs text-amber-600">Feriado: {d.holiday}</p>}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Programados</p>
                    <p className="font-semibold">{d.total}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Confirmados</p>
                    <p className="font-semibold">{d.confirmed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Obras</p>
                    <p className="font-semibold">{d.works}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ausências</p>
                    <p className="font-semibold">{d.absences}</p>
                  </div>
                </div>
                {d.pending > 0 && (
                  <p className="text-xs text-destructive">{d.pending} alocação(ões) com pendência</p>
                )}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/programacao/diaria">Abrir programação</Link>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel p-4">
        <p className="font-display text-sm font-semibold uppercase">Alocações por obra na semana</p>
        <div className="mt-3 space-y-2">
          {(data?.works ?? []).map((w) => {
            const counts = perDay.map((d) => d.allocs.filter((a) => a.work_id === w.id).length);
            const total = counts.reduce((s, n) => s + n, 0);
            if (total === 0) return null;
            return (
              <div key={w.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm">
                <span className="truncate">
                  <span className="font-mono text-xs text-muted-foreground">{w.code}</span> {w.name}
                </span>
                <span className="flex shrink-0 gap-1">
                  {counts.map((c, i) => (
                    <span
                      key={i}
                      className="flex h-6 w-6 items-center justify-center rounded text-xs"
                      style={{ background: c ? "hsl(var(--primary) / 0.15)" : "transparent" }}
                    >
                      {c || "–"}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
          {!(data?.works ?? []).length && <p className="text-sm text-muted-foreground">Nenhuma obra ativa.</p>}
        </div>
      </div>
    </div>
  );
}

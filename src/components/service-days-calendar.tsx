import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Calendário dos dias com efetivo escalado nos serviços informados (Programação). */
export function ServiceDaysCalendar({ workIds, names, multi }: { workIds: string[]; names: Record<string, string>; multi: boolean }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["service-days", workIds.join(",")],
    enabled: open && workIds.length > 0,
    queryFn: async () => {
      const out: { work_id: string; daily_schedules: { schedule_date: string } | null }[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await supabase
          .from("daily_allocations")
          .select("work_id, daily_schedules(schedule_date)")
          .in("work_id", workIds)
          .order("id")
          .range(f, f + 999);
        if (error) throw error;
        out.push(...((data ?? []) as any));
        if (!data || data.length < 1000) break;
      }
      const byDay = new Map<string, Set<string>>();
      for (const r of out) {
        const d = r.daily_schedules?.schedule_date;
        if (!d) continue;
        if (!byDay.has(d)) byDay.set(d, new Set());
        byDay.get(d)!.add(r.work_id);
      }
      return byDay;
    },
  });
  const toDate = (s: string) => new Date(s + "T12:00:00");
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { single, many, last } = useMemo(() => {
    const single: Date[] = [], many: Date[] = [];
    let last: string | undefined;
    for (const [d, s] of q.data ?? []) {
      (multi && s.size > 1 ? many : single).push(toDate(d));
      if (!last || d > last) last = d;
    }
    return { single, many, last };
  }, [q.data, multi]);
  const pickedWorks = picked ? [...(q.data?.get(picked) ?? [])].map((id) => names[id] ?? "—").sort() : [];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!workIds.length}>
        <CalendarDays className="mr-1 h-4 w-4" /> Calendário
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-fit">
          <DialogHeader>
            <DialogTitle>Dias com serviço</DialogTitle>
          </DialogHeader>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <Calendar
                mode="single"
                numberOfMonths={2}
                defaultMonth={last ? toDate(last) : undefined}
                selected={picked ? toDate(picked) : undefined}
                onSelect={(d) => setPicked(d ? iso(d) : null)}
                modifiers={{ served: single, multi: many }}
                modifiersClassNames={{
                  served: "bg-primary/20 font-semibold rounded-md",
                  multi: "bg-primary text-primary-foreground font-bold rounded-md ring-2 ring-primary/40",
                }}
                className="p-3 pointer-events-auto"
              />
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary/20" /> Dia com serviço</span>
                {multi && <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary" /> Mais de um serviço no dia</span>}
                <span>{(q.data?.size ?? 0)} dias no total</span>
              </div>
              {picked && (
                <div className="text-sm">
                  <b>{picked.split("-").reverse().join("/")}:</b>{" "}
                  {pickedWorks.length ? pickedWorks.join(", ") : "sem serviço"}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

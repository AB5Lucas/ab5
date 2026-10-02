import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Tons da cor principal: 1 serviço = cor cheia clara; 2 = diagonal em 2 tons; 3 = 3 faixas; 4+ = tom escuro inteiro.
const tone = (p: number) => `color-mix(in oklch, var(--primary) ${p}%, var(--background))`;
const BG = [
  tone(35),
  `linear-gradient(135deg, ${tone(30)} 50%, ${tone(65)} 50%)`,
  `linear-gradient(135deg, ${tone(25)} 33.3%, ${tone(50)} 33.3% 66.6%, ${tone(80)} 66.6%)`,
  tone(100),
];
const LEGEND = ["1 serviço", "2 serviços", "3 serviços", "4 ou mais"];
const cell = { borderRadius: 6, fontWeight: 600 } as const;

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
  const { groups, last } = useMemo(() => {
    const groups: Date[][] = [[], [], [], []];
    let last: string | undefined;
    for (const [d, s] of q.data ?? []) {
      groups[Math.min(multi ? s.size : 1, 4) - 1]!.push(toDate(d));
      if (!last || d > last) last = d;
    }
    return { groups, last };
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
                {...(last ? { defaultMonth: toDate(last) } : {})}
                {...(picked ? { selected: toDate(picked) } : {})}
                onSelect={(d: Date | undefined) => setPicked(d ? iso(d) : null)}
                modifiers={{ s1: groups[0], s2: groups[1], s3: groups[2], s4: groups[3] }}
                modifiersStyles={{
                  s1: { ...cell, background: BG[0] },
                  s2: { ...cell, background: BG[1] },
                  s3: { ...cell, background: BG[2] },
                  s4: { ...cell, background: BG[3], color: "var(--primary-foreground)" },
                }}
                className="p-3 pointer-events-auto"
              />
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {(multi ? LEGEND : LEGEND.slice(0, 1)).map((l, i) => (
                  <span key={l} className="flex items-center gap-1">
                    <span className="h-4 w-4 rounded" style={{ background: BG[i] }} /> {l}
                  </span>
                ))}
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

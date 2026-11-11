import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findDateConflicts } from "@/lib/date-conflicts";
import { formatDateBR, todayISO } from "@/lib/scheduling";
import { entitledToFolga, folgaDaysBy, folgaWeekOf } from "@/lib/weekly-days-off";

const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const dayLabel = (iso: string) => `${WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${formatDateBR(iso).slice(0, 5)}`;

type Person = { id: string; name: string; reg: string; days: string[] };
const NONE = { data: [] as { schedule_id: string; collaborator_id: string }[], error: null };

/** Folga semanal: quem trabalhou sábado e domingo e em que dia da semana folga (ou folgou). */
export function WeeklyDaysOffDialog({ date, open, onOpenChange, editable }: { date: string; open: boolean; onOpenChange: (v: boolean) => void; editable: boolean }) {
  const qc = useQueryClient();
  const week = useMemo(() => folgaWeekOf(date), [date]);
  const monday = week.days[0]!;
  const sunday = week.days[6]!;
  const lastDay = week.window[week.window.length - 1]!;
  const today = todayISO();
  const [pick, setPick] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["weekly-folgas", monday],
    enabled: open,
    queryFn: async (): Promise<Person[]> => {
      const { data: schedules, error } = await supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", week.saturday).lte("schedule_date", lastDay);
      if (error) throw error;
      const dateOf = new Map((schedules ?? []).map((s) => [s.id, s.schedule_date as string]));
      const idsOn = (d: string) => (schedules ?? []).filter((s) => s.schedule_date === d).map((s) => s.id);
      const weekendIds = [...idsOn(week.saturday), ...idsOn(week.sunday)];
      const weekIds = week.window.flatMap(idsOn);
      const [alloc, box, off] = await Promise.all([
        weekendIds.length ? supabase.from("daily_allocations").select("schedule_id, collaborator_id").in("schedule_id", weekendIds).range(0, 9999) : Promise.resolve(NONE),
        weekIds.length ? supabase.from("daily_status_entries").select("schedule_id, collaborator_id").in("schedule_id", weekIds).eq("box_key", "folga").range(0, 9999) : Promise.resolve(NONE),
        supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", lastDay).or(`end_date.gte.${monday},and(end_date.is.null,date.gte.${monday})`).range(0, 9999),
      ]);
      for (const r of [alloc, box, off]) if (r.error) throw r.error;
      const on = (d: string) => (alloc.data ?? []).filter((a) => dateOf.get(a.schedule_id) === d).map((a) => a.collaborator_id);
      const ids = entitledToFolga({ saturday: on(week.saturday), sunday: on(week.sunday) });
      if (!ids.length) return [];
      const folgas = folgaDaysBy(week, off.data ?? [], (box.data ?? []).map((b) => ({ collaborator_id: b.collaborator_id, date: dateOf.get(b.schedule_id)! })));
      const people: { id: string; full_name: string; registration_number: string }[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error: pe } = await supabase.from("collaborators").select("id, full_name, registration_number").in("id", ids.slice(i, i + 200));
        if (pe) throw pe;
        people.push(...(data ?? []));
      }
      return people
        .map((p) => ({ id: p.id, name: p.full_name, reg: p.registration_number, days: folgas.get(p.id) ?? [] }))
        .sort((a, b) => Number(a.days.length > 0) - Number(b.days.length > 0) || a.name.localeCompare(b.name, "pt-BR"));
    },
  });

  const schedule = useMutation({
    mutationFn: async ({ person, day }: { person: Person; day: string }) => {
      const conflicts = await findDateConflicts(person.id, day, day);
      if (conflicts.length) throw new Error(`${person.name}: ${conflicts.join("; ")}`);
      const { error } = await supabase.from("days_off").insert({ collaborator_id: person.id, date: day, reason: "Folga semanal" });
      if (error) throw error;
      // Se a programação do dia já existe, tira a pessoa da obra e coloca na caixa FOLGAS.
      const { data: sched, error: se } = await supabase.from("daily_schedules").select("id").eq("schedule_date", day).maybeSingle();
      if (se) throw se;
      if (sched) {
        const { error: de } = await supabase.from("daily_allocations").delete().eq("schedule_id", sched.id).eq("collaborator_id", person.id);
        if (de) throw de;
        const { data: last } = await supabase.from("daily_status_entries").select("sort_order").eq("schedule_id", sched.id).eq("box_key", "folga").order("sort_order", { ascending: false }).limit(1);
        const { error: ue } = await supabase.from("daily_status_entries").upsert(
          { schedule_id: sched.id, collaborator_id: person.id, box_key: "folga", sort_order: (last?.[0]?.sort_order ?? -1) + 1 },
          { onConflict: "schedule_id,collaborator_id" },
        );
        if (ue) throw ue;
      }
      return { person, day };
    },
    onSuccess: ({ person, day }) => {
      toast.success(`Folga de ${person.name} agendada para ${dayLabel(day)}`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data ?? [];
  const missing = rows.filter((r) => !r.days.length).length;
  const defaultDay = week.window.find((d) => d >= today && d !== sunday) ?? monday;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Folgas da semana</DialogTitle>
          <DialogDescription>
            Trabalharam no sábado {formatDateBR(week.saturday)} e no domingo {formatDateBR(week.sunday)}: folga nesta semana ({formatDateBR(monday)} a {formatDateBR(sunday)}) ou na seguinte (até {formatDateBR(lastDay)}).
          </DialogDescription>
        </DialogHeader>
        {list.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {list.error && <p className="text-sm text-destructive">{(list.error as Error).message}</p>}
        {!list.isLoading && !list.error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Ninguém trabalhou nos dois dias desse fim de semana.</p>
        )}
        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {rows.length} com direito · {missing ? `${missing} sem folga marcada` : "todos com folga marcada"}
          </p>
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((p) => {
            const day = pick[p.id] ?? defaultDay;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.reg}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.days.length ? (
                    p.days.map((d) => (
                      <Badge key={d} variant={d < today ? "secondary" : "default"} title={d < today ? "Já folgou" : "Folga programada"}>
                        {d < today ? "Folgou" : "Folga"} {dayLabel(d)}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline" className="border-warning text-warning">Sem folga</Badge>
                  )}
                </div>
                {editable && (
                  <div className="flex items-center gap-1">
                    <Select value={day} onValueChange={(v) => setPick((s) => ({ ...s, [p.id]: v }))}>
                      <SelectTrigger className="h-8 w-[118px] text-xs" aria-label={`Dia da folga de ${p.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {week.window.map((d) => (
                          <SelectItem key={d} value={d} disabled={p.days.includes(d)}>{dayLabel(d)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-8" disabled={schedule.isPending || p.days.includes(day)} onClick={() => schedule.mutate({ person: p, day })}>
                      Agendar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

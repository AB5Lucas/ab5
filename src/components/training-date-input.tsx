import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toDate = (s: string) => { const [y, m, d] = s.split("-").map(Number) as [number, number, number]; return new Date(y, m - 1, d); };
const br = (s: string) => s.split("-").reverse().join("/");

/**
 * Data do agendamento de treinamento: calendário que marca os dias em que já há alguém agendado para o mesmo
 * treinamento (bolinha + número de pessoas), para juntar a turma. Sem treinamento escolhido, é um calendário comum.
 */
export function TrainingDateInput({ id, value, onChange, trainingId, ignoreId }: {
  id?: string; value: string; onChange: (v: string) => void; trainingId: string | null | undefined; ignoreId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const today = iso(new Date());
  const booked = useQuery({
    queryKey: ["training-booked-days", trainingId],
    enabled: !!trainingId,
    queryFn: async () => (await supabase.from("appointments").select("id, scheduled_date, collaborators(full_name)")
      .eq("type", "treinamento").eq("training_id", trainingId!).eq("status", "agendado").gte("scheduled_date", today)).data ?? [],
  });
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of booked.data ?? []) {
      if (a.id === ignoreId) continue;
      const name = (a.collaborators as { full_name?: string } | null)?.full_name ?? "—";
      m.set(a.scheduled_date, [...(m.get(a.scheduled_date) ?? []), name]);
    }
    return m;
  }, [booked.data, ignoreId]);
  const days = [...byDay.keys()].sort();
  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="flex w-full justify-start font-normal">
            <CalendarDays className="h-4 w-4" />
            {value ? br(value) : "Escolha a data"}
            {value && byDay.has(value) && <span className="ml-auto text-xs text-primary">{byDay.get(value)!.length} já agendado(s)</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            defaultMonth={value ? toDate(value) : days[0] ? toDate(days[0]) : new Date()}
            selected={value ? toDate(value) : undefined}
            onSelect={(d) => { if (d) { onChange(iso(d)); setOpen(false); } }}
            modifiers={{ booked: days.map(toDate) }}
            modifiersClassNames={{ booked: "font-semibold text-primary [&_button]:relative [&_button]:after:absolute [&_button]:after:bottom-0.5 [&_button]:after:left-1/2 [&_button]:after:h-1 [&_button]:after:w-1 [&_button]:after:-translate-x-1/2 [&_button]:after:rounded-full [&_button]:after:bg-primary" }}
          />
          {trainingId && (
            <div className="max-w-72 border-t border-border p-2 text-xs">
              {!days.length ? <p className="text-muted-foreground">Ninguém agendado para este treinamento.</p> : (
                <>
                  <p className="mb-1 text-muted-foreground">Dias com gente agendada (marcados no calendário):</p>
                  <ul className="space-y-0.5">
                    {days.slice(0, 8).map((d) => (
                      <li key={d}>
                        <button type="button" className="text-left hover:underline" onClick={() => { onChange(d); setOpen(false); }} title={byDay.get(d)!.join(", ")}>
                          <b>{br(d)}</b> · {byDay.get(d)!.length} pessoa(s)
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

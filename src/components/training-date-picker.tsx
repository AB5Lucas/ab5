import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toDate = (s: string) => new Date(s + "T12:00:00");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Seletor de data que destaca os dias com treinamentos realizados. */
export function TrainingDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const days = useQuery({
    queryKey: ["training-days"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const set = new Set<string>();
      for (let f = 0; ; f += 1000) {
        const { data, error } = await supabase.from("collaborator_trainings").select("completed_at").not("completed_at", "is", null).order("id").range(f, f + 999);
        if (error) throw error;
        for (const r of data ?? []) if (r.completed_at) set.add(String(r.completed_at).slice(0, 10));
        if (!data || data.length < 1000) break;
      }
      return [...set].map(toDate);
    },
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-44 justify-start font-normal">
          <CalendarDays className="mr-2 h-4 w-4" />
          {value ? value.split("-").reverse().join("/") : "Selecionar"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          {...(value ? { selected: toDate(value), defaultMonth: toDate(value) } : {})}
          onSelect={(d: Date | undefined) => { if (d) { onChange(iso(d)); setOpen(false); } }}
          modifiers={{ trained: days.data ?? [] }}
          modifiersStyles={{ trained: { background: "color-mix(in oklch, var(--primary) 30%, var(--background))", borderRadius: 6, fontWeight: 600 } }}
          className="p-3 pointer-events-auto"
        />
        <div className="flex items-center gap-1 px-3 pb-3 text-xs text-muted-foreground">
          <span className="h-3 w-3 rounded" style={{ background: "color-mix(in oklch, var(--primary) 30%, var(--background))" }} /> Dias com treinamento
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Período em dias, no formato "AAAA-MM-DD" (fim incluído). */
export type DayRange = { from: string; to: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toDate = (s: string) => { const [y, m, d] = s.split("-").map(Number) as [number, number, number]; return new Date(y, m - 1, d); };
const br = (s: string) => s.split("-").reverse().join("/");

/** Mês atual inteiro (do dia 1 ao último dia). */
export function currentMonthRange(base = new Date()): DayRange {
  return { from: iso(new Date(base.getFullYear(), base.getMonth(), 1)), to: iso(new Date(base.getFullYear(), base.getMonth() + 1, 0)) };
}
/** Meses (AAAA-MM) que o período cobre. */
export function monthsInRange(r: DayRange): string[] {
  const out: string[] = [];
  let [y, m] = r.from.slice(0, 7).split("-").map(Number) as [number, number];
  const end = r.to.slice(0, 7);
  for (let guard = 0; guard < 60; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push(ym);
    if (ym >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Filtro de período por calendário: clique no primeiro e no último dia. Atalhos para os períodos mais usados.
 * O título fica em cima do campo, como nos outros filtros.
 */
export function DateRangePicker({ value, onChange, label = "Período", id }: { value: DayRange; onChange: (r: DayRange) => void; label?: string; id?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const today = new Date();
  const presets: { label: string; range: DayRange }[] = [
    { label: "Este mês", range: currentMonthRange(today) },
    { label: "Mês passado", range: currentMonthRange(new Date(today.getFullYear(), today.getMonth() - 1, 1)) },
    { label: "Últimos 7 dias", range: { from: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), to: iso(today) } },
    { label: "Últimos 30 dias", range: { from: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), to: iso(today) } },
  ];
  const pick = (r: DayRange) => { onChange(r); setOpen(false); };

  return (
    <div className="space-y-1">
      {/* block: o botão do calendário é inline e, sem isso, o título fica ao lado em vez de em cima. */}
      <Label htmlFor={id} className="block">{label}</Label>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft({ from: toDate(value.from), to: toDate(value.to) }); }}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" className="flex w-60 justify-start font-normal">
            <CalendarDays className="h-4 w-4" />
            {value.from === value.to ? br(value.from) : `${br(value.from)} a ${br(value.to)}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-row flex-wrap gap-1 border-b border-border p-2 sm:flex-col sm:border-b-0 sm:border-r">
              {presets.map((p) => <Button key={p.label} variant="ghost" size="sm" className="justify-start" onClick={() => pick(p.range)}>{p.label}</Button>)}
            </div>
            <div>
              <Calendar
                mode="range"
                locale={ptBR}
                numberOfMonths={2}
                defaultMonth={draft?.from ?? toDate(value.from)}
                selected={draft}
                onSelect={(r) => setDraft(r)}
              />
              <div className="flex items-center justify-between gap-2 border-t border-border p-2 text-xs text-muted-foreground">
                <span>{draft?.from ? `${br(iso(draft.from))}${draft.to ? ` a ${br(iso(draft.to))}` : " — escolha o último dia"}` : "Escolha o primeiro dia"}</span>
                <Button size="sm" disabled={!draft?.from} onClick={() => draft?.from && pick({ from: iso(draft.from), to: iso(draft.to ?? draft.from) })}>Aplicar</Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

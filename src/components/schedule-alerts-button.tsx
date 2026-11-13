import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScheduleAlerts } from "@/hooks/use-schedule-alerts";
import { worstAlertTone } from "@/lib/schedule-alerts";

/** Botão discreto ao lado de Folgas: avisos do dia (vermelho = alto impacto, laranja = pequeno impacto). */
export function ScheduleAlertsButton({ date }: { date: string }) {
  const q = useScheduleAlerts(date);
  const alerts = q.data ?? [];
  const tone = worstAlertTone(alerts);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const reds = alerts.filter((a) => a.tone === "red").length, oranges = alerts.length - reds;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" title={alerts.length ? `${reds} alto impacto · ${oranges} pequeno impacto` : "Sem avisos para este dia"}>
          <AlertTriangle className={`h-4 w-4 ${tone === "red" ? "text-destructive" : tone === "orange" ? "text-orange-500" : "text-muted-foreground"}`} />
          Avisos
          {reds > 0 && <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold leading-4 text-destructive">{reds}</span>}
          {oranges > 0 && <span className="rounded-full bg-orange-500/15 px-1.5 text-[10px] font-semibold leading-4 text-orange-600 dark:text-orange-400">{oranges}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Avisos do dia {date.split("-").reverse().join("/")}</p>
          <p className="text-[11px] text-muted-foreground">Vermelho: alto impacto · Laranja: pequeno impacto</p>
        </div>
        {q.isLoading ? <p className="px-3 py-4 text-sm text-muted-foreground">Verificando...</p>
          : !alerts.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum aviso para este dia.</p>
          : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.key} className="px-3 py-2">
                  <button type="button" className="flex w-full items-start gap-2 text-left" disabled={!a.people.length} onClick={() => setOpen((s) => ({ ...s, [a.key]: !s[a.key] }))}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === "red" ? "bg-destructive" : "bg-orange-500"}`} />
                    <span className="flex-1 text-sm">{a.title}</span>
                    {a.people.length > 0 && <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open[a.key] ? "rotate-180" : ""}`} />}
                  </button>
                  {open[a.key] && (
                    <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {a.people.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
      </PopoverContent>
    </Popover>
  );
}

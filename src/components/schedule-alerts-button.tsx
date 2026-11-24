import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AlertAction } from "@/lib/schedule-alerts";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScheduleAlerts } from "@/hooks/use-schedule-alerts";
import { useSeenAlerts } from "@/hooks/use-seen-alerts";
import { worstAlertTone } from "@/lib/schedule-alerts";
import { invalidateScheduleDay } from "@/lib/invalidate-day";
import { useCurrentUser } from "@/hooks/use-auth";

/** Botão discreto ao lado de Folgas: avisos do dia (vermelho = alto impacto, laranja = pequeno impacto). */
export function ScheduleAlertsButton({ date }: { date: string }) {
  const q = useScheduleAlerts(date);
  const alerts = q.data ?? [];
  const { isSeen, markSeen } = useSeenAlerts();
  // Aviso expandido = visto: continua na lista, mas sai da contagem e do "!" do menu.
  const pending = alerts.filter((a) => !isSeen(date, a));
  const tone = worstAlertTone(pending);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const reds = pending.filter((a) => a.tone === "red").length, oranges = pending.length - reds;
  // Feriado municipal: cadastrar só para o cliente (client_holidays) ou ignorar; a decisão fica gravada e o aviso some.
  const qc = useQueryClient();
  const { canWrite } = useCurrentUser();
  const decide = useMutation({
    mutationFn: async ({ action, register }: { action: Extract<AlertAction, { kind: "municipal_holiday" }>; register: boolean }) => {
      if (register) {
        const { error } = await supabase.from("client_holidays").upsert({ client_id: action.clientId, date: action.date, is_holiday: true, name: action.name }, { onConflict: "client_id,date" });
        if (error) throw error;
      }
      const { error } = await supabase.from("holiday_alert_decisions").upsert({ client_id: action.clientId, date: action.date, decision: register ? "cadastrado" : "ignorado" }, { onConflict: "date,client_id" });
      if (error) throw error;
      return register;
    },
    onSuccess: (register) => { toast.success(register ? "Feriado cadastrado para o cliente" : "Aviso ignorado"); qc.invalidateQueries({ queryKey: ["schedule-alerts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Escalado com ausência no dia: tira da obra (a ausência prevalece; a Programação já esconde a linha).
  const removeAllocs = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("daily_allocations").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => { toast.success(`${n} pessoa(s) retirada(s) da obra`); invalidateScheduleDay(qc); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" title={pending.length ? `${reds} alto impacto · ${oranges} pequeno impacto` : alerts.length ? "Avisos já vistos" : "Sem avisos para este dia"}>
          <AlertTriangle className={`h-4 w-4 ${tone === "red" ? "text-destructive" : tone === "orange" ? "text-orange-500" : "text-muted-foreground"}`} />
          Avisos
          {reds > 0 && <span className="rounded-[4px] bg-destructive/15 px-1.5 text-[10px] font-semibold leading-4 text-destructive">{reds}</span>}
          {oranges > 0 && <span className="rounded-[4px] bg-orange-500/15 px-1.5 text-[10px] font-semibold leading-4 text-orange-600 dark:text-orange-400">{oranges}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Avisos do dia {date.split("-").reverse().join("/")}</p>
          <p className="text-[11px] text-muted-foreground">Vermelho: alto impacto · Laranja: pequeno impacto · Ao abrir um aviso, ele sai da contagem</p>
        </div>
        {q.isLoading ? <p className="px-3 py-4 text-sm text-muted-foreground">Verificando...</p>
          : !alerts.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum aviso para este dia.</p>
          : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.key} className="px-3 py-2">
                  <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => { markSeen(date, a); setOpen((s) => ({ ...s, [a.key]: !s[a.key] })); }}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isSeen(date, a) ? "bg-muted-foreground/40" : a.tone === "red" ? "bg-destructive" : "bg-orange-500"}`} />
                    <span className={`flex-1 text-sm ${isSeen(date, a) ? "text-muted-foreground" : ""}`}>{a.title}</span>
                    {a.people.length > 0 && <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open[a.key] ? "rotate-180" : ""}`} />}
                  </button>
                  {a.action?.kind === "municipal_holiday" && (() => {
                    const action = a.action;
                    return (
                      <div className="mt-1.5 flex gap-1.5 pl-4">
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ action, register: true })}>Cadastrar feriado para o cliente</Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ action, register: false })}>Ignorar</Button>
                      </div>
                    );
                  })()}
                  {a.action?.kind === "remove_allocations" && canWrite && (() => {
                    const ids = a.action.ids;
                    return (
                      <div className="mt-1.5 flex gap-1.5 pl-4">
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={removeAllocs.isPending} onClick={() => removeAllocs.mutate(ids)}>Tirar da obra</Button>
                      </div>
                    );
                  })()}
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

import { useCallback, useEffect, useState } from "react";
import type { ScheduleAlert } from "@/lib/schedule-alerts";

/**
 * Avisos da Programação já vistos (expandidos) neste navegador: deixam de contar no botão Avisos e no "!" do menu.
 * A marca vale para o dia e o conteúdo do aviso: se mudar (outra pessoa, outro veículo), ele volta a aparecer.
 */
const KEY = "schedule-alerts-seen";
const EVENT = "schedule-alerts-seen";
const sig = (date: string, a: ScheduleAlert) => `${date}|${a.key}|${a.title}|${a.people.join(";")}`;

function read(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function useSeenAlerts() {
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    const sync = () => setSeen(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const isSeen = useCallback((date: string, a: ScheduleAlert) => !!seen[sig(date, a)], [seen]);
  const markSeen = useCallback((date: string, a: ScheduleAlert) => {
    const cur = read();
    const k = sig(date, a);
    if (cur[k]) return;
    cur[k] = new Date().toISOString();
    // Guarda só os últimos 60 dias.
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
    for (const [x, t] of Object.entries(cur)) if (t < cutoff) delete cur[x];
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignora */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { isSeen, markSeen };
}

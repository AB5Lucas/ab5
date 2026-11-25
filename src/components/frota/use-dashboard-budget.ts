import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadResultShared } from "@/lib/results-engine";
import { fetchAll } from "@/lib/fetch-all";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { serviceTransportBudget } from "@/lib/fleet-budget";

export function useDashboardBudget(from: string, to: string, enabled: boolean) {
  const works = useQuery({ queryKey: ["fin-works"], enabled, queryFn: () => fetchAll<any>((a, b) => supabase.from("works").select("*, clients(name)").order("id").range(a, b)) });
  const holidays = useQuery({ queryKey: ["holidays-dates"], enabled, queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date) });
  const active = useQuery({ queryKey: ["fin-active", from, to], enabled, queryFn: () => loadFinanceActive(from, to) });
  const shared = useQuery({ queryKey: ["fin-shared"], enabled, staleTime: 60_000, queryFn: loadResultShared });
  const list = useMemo(() => financeList(works.data ?? [], active.data, from, to), [works.data, active.data, from, to]);
  const batches = useMemo(() => financeBatches(list), [list]);
  const batchKey = batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|");
  const raws = useQuery({ queryKey: ["fin-client-raw", batchKey, to], enabled: enabled && !!shared.data && !!active.data, staleTime: 60_000, queryFn: () => shared.data ? loadFinanceRaws(batches, shared.data, { until: to }) : Promise.resolve(new Map()) });
  const data = useMemo(() => {
    if (!raws.data || !works.data || !holidays.data) return null;
    const months = new Set<string>();
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.add(d.toISOString().slice(0, 7));
    return new Map([...months].map((m) => [m, list.reduce((sum, w) => {
      const raw = raws.data.get(w.id);
      return sum + (raw ? serviceTransportBudget(w, raw, m, { holidays: holidays.data ?? [], allWorks: works.data ?? [] })?.value ?? 0 : 0);
    }, 0)]));
  }, [raws.data, works.data, holidays.data, list, from, to]);
  return { data, error: works.error ?? holidays.error ?? active.error ?? shared.error ?? raws.error };
}
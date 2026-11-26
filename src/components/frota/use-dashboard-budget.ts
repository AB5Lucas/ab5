import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadResultShared } from "@/lib/results-engine";
import { fetchAll } from "@/lib/fetch-all";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { serviceTransportBudget } from "@/lib/fleet-budget";

/** Validade do orçado guardado: mês corrente (ou futuro) 3 h; meses passados 3 dias. */
const FRESH_CURRENT_MS = 3 * 3600_000, FRESH_PAST_MS = 3 * 86400_000;
const monthsOf = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from.slice(0, 7)}-01T12:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.toISOString().slice(0, 7));
  return out;
};

/**
 * Orçado de transporte por mês para o dashboard de Veículos (mesmo cálculo da Visão Geral: serviceTransportBudget
 * sobre o motor dos Resultados, pesado). Para abrir na hora: lê primeiro o valor guardado em fleet_budget_cache e
 * mostra; o cálculo completo só roda (por trás) quando falta algum mês ou o guardado está velho, e então regrava.
 */
export function useDashboardBudget(from: string, to: string, enabled: boolean) {
  const qc = useQueryClient();
  const months = useMemo(() => monthsOf(from, to), [from, to]);
  const cache = useQuery({
    queryKey: ["fleet-budget-cache", months.join(",")], enabled, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("fleet_budget_cache" as never).select("ym, value, computed_at").in("ym", months);
      if (error) throw error;
      return new Map(((data ?? []) as { ym: string; value: number; computed_at: string }[]).map((r) => [r.ym, r]));
    },
  });
  const thisYm = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
  const stale = useMemo(() => {
    if (!cache.data) return null;
    return months.filter((m) => {
      const c = cache.data.get(m);
      if (!c) return true;
      const age = Date.now() - new Date(c.computed_at).getTime();
      return age > (m >= thisYm ? FRESH_CURRENT_MS : FRESH_PAST_MS);
    });
  }, [cache.data, months, thisYm]);
  const compute = enabled && !!stale && stale.length > 0;

  const works = useQuery({ queryKey: ["fin-works"], enabled: compute, queryFn: () => fetchAll<any>((a, b) => supabase.from("works").select("*, clients(name)").order("id").range(a, b)) });
  const holidays = useQuery({ queryKey: ["holidays-dates"], enabled: compute, queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date) });
  const active = useQuery({ queryKey: ["fin-active", from, to], enabled: compute, queryFn: () => loadFinanceActive(from, to) });
  const shared = useQuery({ queryKey: ["fin-shared"], enabled: compute, staleTime: 60_000, queryFn: loadResultShared });
  const list = useMemo(() => financeList(works.data ?? [], active.data, from, to), [works.data, active.data, from, to]);
  const batches = useMemo(() => financeBatches(list), [list]);
  const batchKey = batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|");
  const raws = useQuery({ queryKey: ["fin-client-raw", batchKey, to], enabled: compute && !!shared.data && !!active.data && !!works.data, staleTime: 60_000, queryFn: () => shared.data ? loadFinanceRaws(batches, shared.data, { until: to }) : Promise.resolve(new Map()) });
  const computed = useMemo(() => {
    if (!compute || !raws.data || !works.data || !holidays.data) return null;
    return new Map(months.map((m) => [m, list.reduce((sum, w) => {
      const raw = raws.data.get(w.id);
      return sum + (raw ? serviceTransportBudget(w, raw, m, { holidays: holidays.data ?? [], allWorks: works.data ?? [] })?.value ?? 0 : 0);
    }, 0)]));
  }, [compute, raws.data, works.data, holidays.data, list, months]);

  // Regrava o guardado com o cálculo novo (uma vez por resultado).
  const saved = useRef<unknown>(null);
  useEffect(() => {
    if (!computed || saved.current === computed) return;
    saved.current = computed;
    const rows = [...computed.entries()].map(([ym, value]) => ({ ym, value: Math.round(value * 100) / 100, computed_at: new Date().toISOString() }));
    void supabase.from("fleet_budget_cache" as never).upsert(rows as never, { onConflict: "ym" }).then(() => qc.invalidateQueries({ queryKey: ["fleet-budget-cache"] }));
  }, [computed]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (computed) return computed;
    if (!cache.data) return null;
    // Falta mês no guardado: espera o cálculo; senão mostra o guardado (mesmo velho) enquanto recalcula.
    if (months.some((m) => !cache.data.has(m))) return null;
    return new Map(months.map((m) => [m, Number(cache.data.get(m)!.value)]));
  }, [computed, cache.data, months]);
  return { data, error: cache.error ?? (compute ? works.error ?? holidays.error ?? active.error ?? shared.error ?? raws.error : null) };
}

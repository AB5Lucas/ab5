import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccess } from "@/hooks/use-access";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/scheduling";
import { addDaysIso, nextBusinessDay } from "@/lib/schedule-alerts";
import { fetchScheduleAlerts } from "@/lib/schedule-alerts.data";

/** Avisos do dia aberto na Programação. */
export function useScheduleAlerts(date: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["schedule-alerts", date],
    enabled: !!date,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await fetchScheduleAlerts(date, qc)).alerts,
  });
}

/** Avisos do próximo dia útil (para o "!" do menu Programação). */
export function useNextBusinessDayAlerts() {
  // Só para quem acessa a Programação (o "!" fica no menu dela).
  const { canAccess, loading } = useAccess();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["schedule-alerts", "next-business-day"],
    enabled: !loading && canAccess("/programacao/diaria"),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const today = todayISO();
      const { data } = await supabase.from("holidays").select("date").gte("date", today).lte("date", addDaysIso(today, 40));
      const date = nextBusinessDay(today, new Set((data ?? []).map((h) => h.date)));
      return { date, alerts: (await fetchScheduleAlerts(date, qc)).alerts };
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/scheduling";
import { addDaysIso, nextBusinessDay } from "@/lib/schedule-alerts";
import { fetchScheduleAlerts } from "@/lib/schedule-alerts.data";

/** Avisos do dia aberto na Programação. */
export function useScheduleAlerts(date: string) {
  return useQuery({
    queryKey: ["schedule-alerts", date],
    enabled: !!date,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await fetchScheduleAlerts(date)).alerts,
  });
}

/** Avisos do próximo dia útil (para o "!" do menu Programação). */
export function useNextBusinessDayAlerts() {
  return useQuery({
    queryKey: ["schedule-alerts", "next-business-day"],
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const today = todayISO();
      const { data } = await supabase.from("holidays").select("date").gte("date", today).lte("date", addDaysIso(today, 40));
      const date = nextBusinessDay(today, new Set((data ?? []).map((h) => h.date)));
      return { date, alerts: (await fetchScheduleAlerts(date)).alerts };
    },
  });
}

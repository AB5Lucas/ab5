import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { todayISO } from "@/lib/scheduling";
import { mergePendingClients, serviceDistribution, recentRange, isTresCoracoes, isWeekend, type DistributionAllocation, type DistributionWork } from "@/lib/service-distribution";

export const SERVICE_BADGE_DATE = ["service-badge-date"];

type Alloc = DistributionAllocation & { schedule_id: string };

/** Sem data: menu lateral, conta clientes pendentes da semana atual + próxima. Com data: só aquele dia. */
export function useServiceDistribution(selectedDate?: string) {
  const { user, role, loading } = useCurrentUser();
  const today = todayISO();
  const range = selectedDate ? { start: selectedDate, end: selectedDate } : recentRange(today);
  return useQuery({
    queryKey: ["service-distribution", user?.id, role, range.start, range.end],
    enabled: !!user && !loading,
    staleTime: 0,
    refetchInterval: 60000,
    queryFn: async () => {
      const { start, end } = range;
      const [schedules, allWorks, links, clientRows] = await Promise.all([
        fetchAll<{ id: string; schedule_date: string }>((a, b) => supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", start).lte("schedule_date", end).order("id").range(a, b)),
        fetchAll<DistributionWork>((a, b) => supabase.from("works").select("id, client_id, active").order("id").range(a, b)),
        role === "admin" || role === "programmer" ? Promise.resolve(null) : fetchAll<{ works: { client_id: string | null } | null }>((a, b) => supabase.from("foreman_works").select("works(client_id)").eq("user_id", user?.id ?? "").order("id").range(a, b)),
        fetchAll<{ id: string; name: string }>((a, b) => supabase.from("clients").select("id, name").order("id").range(a, b)),
      ]);
      const tres = new Set(clientRows.filter((c) => isTresCoracoes(c.name)).map((c) => c.id));
      const allowed = links ? new Set(links.map((l) => l.works?.client_id)) : null;
      const works = allowed ? allWorks.filter((w) => allowed.has(w.client_id)) : allWorks;
      if (!schedules.length) return serviceDistribution(works, []);
      const ids = schedules.map((s) => s.id);
      const [allocations, off, vacations, medical, training, trainingBox] = await Promise.all([
        fetchAll<Alloc>((a, b) => supabase.from("daily_allocations").select("schedule_id, work_id, collaborator_id, service_assigned").in("schedule_id", ids).eq("service_assigned", false).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; date: string; end_date: string | null }>((a, b) => supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", end).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; start_date: string; end_date: string }>((a, b) => supabase.from("vacations").select("collaborator_id, start_date, end_date").lte("start_date", end).gte("end_date", start).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; start_date: string; end_date: string }>((a, b) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lte("start_date", end).gte("end_date", start).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; scheduled_date: string }>((a, b) => supabase.from("appointments").select("collaborator_id, scheduled_date").eq("type", "treinamento").gte("scheduled_date", start).lte("scheduled_date", end).neq("status", "cancelado").order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; schedule_id: string }>((a, b) => supabase.from("daily_status_entries").select("collaborator_id, schedule_id").in("schedule_id", ids).eq("box_key", "treinamento").order("id").range(a, b)),
      ]);
      const days = schedules.map((s) => {
        const date = s.schedule_date;
        const excluded = new Set([
          ...off.filter((o) => o.date <= date && (o.end_date ?? o.date) >= date),
          ...vacations.filter((v) => v.start_date <= date && v.end_date >= date),
          ...medical.filter((m) => m.start_date <= date && m.end_date >= date),
          ...training.filter((t) => t.scheduled_date === date),
          ...trainingBox.filter((t) => t.schedule_id === s.id),
        ].map((r) => r.collaborator_id));
        const r = serviceDistribution(works, allocations.filter((a) => a.schedule_id === s.id), excluded);
        return isWeekend(date) ? r : { pendingClientIds: r.pendingClientIds.filter((id) => !tres.has(id)) };
      });
      return mergePendingClients(days);
    },
  });
}

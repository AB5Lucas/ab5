import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { addDays, todayISO } from "@/lib/scheduling";
import { serviceDistribution, type DistributionAllocation, type DistributionWork } from "@/lib/service-distribution";

export const SERVICE_BADGE_DATE = ["service-badge-date"];

export function useServiceDistribution(selectedDate?: string) {
  const { user, role, loading, isForeman } = useCurrentUser();
  const selected = useQuery<string | null>({ queryKey: SERVICE_BADGE_DATE, queryFn: () => null, initialData: null, staleTime: Infinity });
  const date = selectedDate ?? selected.data ?? addDays(todayISO(), isForeman ? 1 : 0);
  return useQuery({
    queryKey: ["service-distribution", user?.id, role, date],
    enabled: !!user && !loading,
    staleTime: 0,
    refetchInterval: 60000,
    queryFn: async () => {
      const [{ data: schedule, error }, allWorks, links] = await Promise.all([
        supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle(),
        fetchAll<DistributionWork>((a, b) => supabase.from("works").select("id, client_id, active").order("id").range(a, b)),
        role === "admin" || role === "programmer" ? Promise.resolve(null) : fetchAll<{ works: { client_id: string | null } | null }>((a, b) => supabase.from("foreman_works").select("works(client_id)").eq("user_id", user?.id ?? "").order("id").range(a, b)),
      ]);
      if (error) throw error;
      const allowed = links ? new Set(links.map((l) => l.works?.client_id)) : null;
      const works = allowed ? allWorks.filter((w) => allowed.has(w.client_id)) : allWorks;
      if (!schedule) return serviceDistribution(works, []);
      const [allocations, off, vacations, medical, training, trainingBox] = await Promise.all([
        fetchAll<DistributionAllocation>((a, b) => supabase.from("daily_allocations").select("work_id, collaborator_id, service_assigned").eq("schedule_id", schedule.id).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string; date: string; end_date: string | null }>((a, b) => supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string }>((a, b) => supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string }>((a, b) => supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date).order("id").range(a, b)),
        fetchAll<{ collaborator_id: string }>((a, b) => supabase.from("appointments").select("collaborator_id").eq("type", "treinamento").eq("scheduled_date", date).neq("status", "cancelado").order("id").range(a, b)),
        fetchAll<{ collaborator_id: string }>((a, b) => supabase.from("daily_status_entries").select("collaborator_id").eq("schedule_id", schedule.id).eq("box_key", "treinamento").order("id").range(a, b)),
      ]);
      const excluded = new Set([...off.filter((o) => (o.end_date ?? o.date) >= date), ...vacations, ...medical, ...training, ...trainingBox].map((r) => r.collaborator_id));
      return serviceDistribution(works, allocations, excluded);
    },
  });
}
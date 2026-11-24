import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Quem mais está com a Programação do mesmo dia aberta. A presença é renovada a cada 30 s
 * (schedule_presence_ping) e vale 90 s, como o validator_open das SCs; ao sair do dia, some na hora.
 */
export function SchedulePresence({ date }: { date: string }) {
  const q = useQuery({
    queryKey: ["schedule-presence", date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("schedule_presence_ping", { _date: date });
      if (error) return [];
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  useEffect(() => () => { void supabase.rpc("schedule_presence_leave", { _date: date }); }, [date]);
  const names = (q.data ?? []).map((p) => p.full_name);
  if (!names.length) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Outras pessoas com este dia aberto na Programação">
      <Users className="h-3 w-3" /> Também editando: {names.join(", ")}
    </span>
  );
}

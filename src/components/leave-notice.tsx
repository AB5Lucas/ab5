import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR, todayISO } from "@/lib/scheduling";

/** Avisa se o colaborador está (ou estará) de férias ou afastado a partir da data informada. */
export function LeaveNotice({ collaboratorId, date }: { collaboratorId: string; date?: string }) {
  const ref = date || todayISO();
  const q = useQuery({
    queryKey: ["leave-notice", collaboratorId, ref],
    enabled: !!collaboratorId,
    queryFn: async () => {
      const [v, m] = await Promise.all([
        supabase.from("vacations").select("start_date, end_date").eq("collaborator_id", collaboratorId).gte("end_date", ref),
        supabase.from("medical_leaves").select("start_date, end_date").eq("collaborator_id", collaboratorId).gte("end_date", ref),
      ]);
      return [
        ...(v.data ?? []).map((r) => ({ ...r, kind: "Férias" })),
        ...(m.data ?? []).map((r) => ({ ...r, kind: "Afastamento" })),
      ].sort((a, b) => a.start_date.localeCompare(b.start_date));
    },
  });
  if (!collaboratorId || !q.data?.length) return null;
  return (
    <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {q.data.map((r, i) => (
          <div key={i}>
            {r.start_date <= ref ? "Colaborador está" : "Colaborador estará"} em {r.kind.toLowerCase()} de{" "}
            {formatDateBR(r.start_date)} a {formatDateBR(r.end_date)}.
          </div>
        ))}
      </div>
    </div>
  );
}

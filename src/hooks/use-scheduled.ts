import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Pending ("agendado") appointments of a type. Keys: collaborator_id and collaborator_id|ref. */
export function useScheduled(type: "aso" | "treinamento" | "integracao") {
  const q = useQuery({
    queryKey: ["scheduled-tags", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("collaborator_id, training_id, client_id, type")
        .eq("status", "agendado");
      if (error) throw error;
      return data ?? [];
    },
  });
  const set = new Set<string>();
  (q.data ?? []).forEach((a) => {
    const t = String(a.type).toLowerCase();
    const match =
      type === "aso" ? t.includes("aso") : type === "treinamento" ? t.startsWith("trein") : t.startsWith("integ");
    if (!match) return;
    set.add(a.collaborator_id);
    if (a.training_id) set.add(`${a.collaborator_id}|${a.training_id}`);
    if (a.client_id) set.add(`${a.collaborator_id}|${a.client_id}`);
  });
  return set;
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Kind = "aso" | "treinamento" | "integracao";

function matches(kind: Kind, raw: string) {
  const t = String(raw).toLowerCase();
  return kind === "aso" ? t.includes("aso") : kind === "treinamento" ? t.startsWith("trein") : t.startsWith("integ");
}

function addKeys(set: Set<string>, a: { collaborator_id: string; training_id: string | null; client_id: string | null }) {
  set.add(a.collaborator_id);
  if (a.training_id) set.add(`${a.collaborator_id}|${a.training_id}`);
  if (a.client_id) set.add(`${a.collaborator_id}|${a.client_id}`);
}

/** Pending appointments ("agendado") of a type. Keys: collaborator_id and collaborator_id|ref. */
export function useScheduled(type: Kind) {
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
  (q.data ?? []).forEach((a) => matches(type, a.type) && addKeys(set, a));
  return set;
}

/** Items waiting in Conferência (not concluded) of a type. */
export function useInConference(type: Kind) {
  const q = useQuery({
    queryKey: ["conference-tags", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_items")
        .select("collaborator_id, training_id, client_id, type")
        .neq("status", "concluido");
      if (error) throw error;
      return data ?? [];
    },
  });
  const set = new Set<string>();
  (q.data ?? []).forEach((a) => matches(type, a.type) && addKeys(set, a));
  return set;
}

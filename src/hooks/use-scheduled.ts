import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Kind = "aso" | "treinamento" | "integracao";

function matches(kind: Kind, raw: string) {
  const t = String(raw).toLowerCase();
  return kind === "aso" ? t.includes("aso") : kind === "treinamento" ? t.startsWith("trein") : t.startsWith("integ");
}

type Ref = { collaborator_id: string; training_id: string | null; client_id: string | null };

function addKeys(set: Set<string>, a: Ref) {
  set.add(a.collaborator_id);
  if (a.training_id) set.add(`${a.collaborator_id}|${a.training_id}`);
  if (a.client_id) set.add(`${a.collaborator_id}|${a.client_id}`);
}

function fmt(date: string, time: string | null) {
  const [y, m, d] = date.split("-");
  const t = time ? ` às ${time.slice(0, 5)}` : "";
  return `${d}/${m}/${y}${t}`;
}

/** Pending appointments ("agendado") of a type. Keys: collaborator_id and collaborator_id|ref → "Agendado para ..." label. */
export function useScheduled(type: Kind) {
  const q = useQuery({
    queryKey: ["scheduled-tags", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("collaborator_id, training_id, client_id, type, scheduled_date, scheduled_time")
        .eq("status", "agendado")
        .order("scheduled_date")
        .order("scheduled_time");
      if (error) throw error;
      return data ?? [];
    },
  });
  const lists = new Map<string, string[]>();
  (q.data ?? []).forEach((a) => {
    if (!matches(type, a.type)) return;
    const keys = new Set<string>();
    addKeys(keys, a);
    const label = fmt(a.scheduled_date, a.scheduled_time);
    keys.forEach((k) => lists.set(k, [...(lists.get(k) ?? []), label]));
  });
  const map = new Map<string, string>();
  lists.forEach((v, k) => map.set(k, `Agendado para ${v.join(", ")}`));
  return map;
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

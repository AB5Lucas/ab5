import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";

/**
 * Clientes e serviços que a pessoa pode ver nos relatórios e telas financeiras (mesma regra de result-work-access):
 * Clientes vinculados (coordenador) = todos os serviços dos clientes das obras vinculadas; Serviços vinculados
 * (encarregado) e Cliente externo = só as obras vinculadas; demais (Interno, Administrador) = tudo.
 * É filtro de tela; o banco continua liberando conforme as políticas.
 */
export function useWorkScope() {
  const { role, user, loading } = useCurrentUser();
  const scoped = role === "coordenador" || role === "encarregado" || role === "cliente";
  const q = useQuery({
    queryKey: ["work-scope", user?.id, role],
    enabled: !!user?.id && scoped,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("foreman_works").select("work_id, works(client_id)").eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const workIds = new Set((q.data ?? []).map((l) => l.work_id));
  const clientIds = new Set((q.data ?? []).map((l) => (l.works as { client_id: string | null } | null)?.client_id).filter((x): x is string => !!x));
  const byClient = role === "coordenador";
  const allowWork = (w: { id: string; client_id?: string | null } | null | undefined) =>
    !scoped || (!!w && (workIds.has(w.id) || (byClient && !!w.client_id && clientIds.has(w.client_id))));
  const allowClient = (clientId: string | null | undefined) =>
    !scoped || (!!clientId && (clientIds.has(clientId)));
  return { scoped, ready: !loading && (!scoped || !q.isLoading), allowWork, allowClient, workIds, clientIds };
}

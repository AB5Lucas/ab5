import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";

/** Clientes/serviços visíveis no módulo Andaimes: coordenador e encarregado só os clientes atribuídos. */
export function useAndamScope() {
  const { role, user, isAdmin, canWrite, isForeman } = useCurrentUser();
  const scoped = role === "coordenador" || role === "encarregado";
  const clients = useQuery({
    queryKey: ["andam-scope-clients", user?.id, scoped],
    enabled: !!user?.id,
    queryFn: async () => {
      const all = (await supabase.from("clients").select("id, name").eq("active", true).order("name")).data ?? [];
      if (!scoped) return all;
      const { data: links } = await supabase.from("foreman_works").select("works(client_id)").eq("user_id", user!.id);
      const ids = new Set((links ?? []).map((l: any) => l.works?.client_id).filter(Boolean));
      return all.filter((c) => ids.has(c.id));
    },
  });
  const works = useQuery({
    queryKey: ["andam-works"],
    queryFn: async () => (await supabase.from("works").select("id, name, client_id").order("name")).data ?? [],
  });
  return { clients: clients.data ?? [], works: works.data ?? [], user, isAdmin, canEdit: canWrite || isForeman };
}

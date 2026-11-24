import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { companyRoleMatch, positionWithoutLevel } from "@/lib/company-role";
import { useCurrentUser } from "@/hooks/use-auth";

/** Função na empresa (cadastro de Colaboradores, sem nível) do usuário; sem casamento único pelo nome = "Externo". */
export function useCompanyRole() {
  const { profile } = useCurrentUser();
  const q = useQuery({
    queryKey: ["company-role", profile?.full_name ?? ""],
    staleTime: 30 * 60_000,
    enabled: !!profile?.full_name,
    queryFn: async () => {
      const people = (await fetchAll<{ full_name: string; status: string | null; position_id: string | null }>((a, b) =>
        supabase.from("collaborators").select("full_name, status, position_id").order("id").range(a, b)))
        .map((c) => ({ full_name: c.full_name, active: c.status === "active", position_id: c.position_id }));
      const hit = companyRoleMatch(profile?.full_name, people);
      if (!hit?.position_id) return null;
      const { data } = await supabase.from("positions").select("name").eq("id", hit.position_id).maybeSingle();
      return positionWithoutLevel(data?.name ?? null);
    },
  });
  return q.isLoading ? "" : q.data ?? "Externo";
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, type AppRole } from "@/hooks/use-auth";

/** Perfis configuráveis na página Acessos (encarregado segue regra própria: só Externo). */
export const CONFIG_ROLES: AppRole[] = ["admin", "coordenador", "encarregado", "programmer", "viewer"];

/** Sem configuração salva: perfis antigos mantêm acesso total; Coordenador começa sem nada. */
export function defaultAllowed(role: AppRole, url: string) {
  if (role === "encarregado") return url.startsWith("/externo");
  if (role === "coordenador") return false;
  if (url === "/admin/acessos" || url === "/fechamentos/financeiro") return role === "admin";
  return true;
}

export function useRoleAccess() {
  return useQuery({
    queryKey: ["role-access"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_page_access").select("role, path, allowed");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAccess() {
  const { role, loading } = useCurrentUser();
  const q = useRoleAccess();
  const canAccess = (url: string) => {
    if (role === "admin" && url === "/admin/acessos") return true;
    const row = (q.data ?? []).find((r) => r.role === role && r.path === url);
    return row ? row.allowed : defaultAllowed(role, url);
  };
  return { canAccess, loading: loading || q.isLoading };
}

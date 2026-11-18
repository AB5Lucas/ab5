import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, type AppRole } from "@/hooks/use-auth";

/** Perfis configuráveis na página Acessos (encarregado segue regra própria: só Externo). */
export const CONFIG_ROLES: AppRole[] = ["admin", "coordenador", "encarregado", "programmer", "viewer", "cliente"];

/** Sem configuração salva: perfis antigos mantêm acesso total; Coordenador começa sem nada. */
export function defaultAllowed(role: AppRole, url: string) {
  if (role === "encarregado") return url.startsWith("/externo");
  if (role === "coordenador") return false;
  if (role === "cliente") return url === "/externo/relatorio-diario";
  if (url === "/admin/acessos" || url === "/fechamentos/financeiro") return role === "admin";
  return true;
}

export function useRoleAccess() {
  return useQuery({
    queryKey: ["role-access"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("role_page_access").select("role, path, allowed");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUserAccess(userId?: string | null) {
  return useQuery({
    queryKey: ["user-access", userId],
    staleTime: 5 * 60_000,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_page_access")
        .select("path, allowed")
        .eq("user_id", userId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Páginas do grupo de acesso da pessoa (users_profiles.access_group_id → access_group_pages). */
export function useUserGroupAccess(userId?: string | null) {
  return useQuery({
    queryKey: ["group-access", userId],
    staleTime: 5 * 60_000,
    enabled: !!userId,
    queryFn: async () => {
      const { data: me, error } = await supabase.from("users_profiles").select("access_group_id").eq("id", userId!).maybeSingle();
      if (error) throw error;
      if (!me?.access_group_id) return [];
      const { data, error: e2 } = await supabase.from("access_group_pages").select("path, allowed").eq("group_id", me.access_group_id);
      if (e2) throw e2;
      return data ?? [];
    },
  });
}

/** Acesso a uma página: exceção da pessoa > grupo de acesso > perfil (antigo) > padrão. Mesma ordem de can_access_page. */
export function useAccess() {
  const { role, loading, user } = useCurrentUser();
  const q = useRoleAccess();
  const u = useUserAccess(user?.id);
  const g = useUserGroupAccess(user?.id);
  const canAccess = (url: string) => {
    if (role === "admin" && url === "/admin/acessos") return true;
    const ex = (u.data ?? []).find((r) => r.path === url);
    if (ex) return ex.allowed;
    const gp = (g.data ?? []).find((r) => r.path === url);
    if (gp) return gp.allowed;
    const row = (q.data ?? []).find((r) => r.role === role && r.path === url);
    return row ? row.allowed : defaultAllowed(role, url);
  };
  return { canAccess, loading: loading || q.isLoading || (!!user?.id && (u.isLoading || g.isLoading)) };
}

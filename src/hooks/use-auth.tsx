import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "programmer" | "viewer";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  programmer: "Programador",
  viewer: "Consulta",
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useCurrentUser() {
  const { session, user, loading } = useSession();

  const profile = useQuery({
    queryKey: ["me", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: p }, { data: roles }] = await Promise.all([
        supabase.from("users_profiles").select("*").eq("id", user!.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
      ]);
      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      const role: AppRole = roleList.includes("admin")
        ? "admin"
        : roleList.includes("programmer")
          ? "programmer"
          : "viewer";
      return { profile: p, role };
    },
  });

  const role = profile.data?.role ?? "viewer";

  return {
    session,
    user: user as User | null,
    loading: loading || profile.isLoading,
    profile: profile.data?.profile ?? null,
    role,
    isAdmin: role === "admin",
    canWrite: role === "admin" || role === "programmer",
  };
}

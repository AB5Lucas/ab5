import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, User2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { menuUrlFor, MENU_GROUPS } from "@/lib/menu";

let cachedUser: import("@supabase/supabase-js").User | null = null;
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_e, session) => {
    cachedUser = session?.user ?? null;
  });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (cachedUser) return { user: cachedUser };
    // Lê a sessão salva primeiro (não depende de rede) para manter o login ao recarregar.
    let { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      await new Promise((r) => setTimeout(r, 600));
      ({ data: s } = await supabase.auth.getSession());
    }
    if (s.session?.user) { cachedUser = s.session.user; return { user: s.session.user }; }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    cachedUser = data.user;
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { profile, role, isForeman } = useCurrentUser();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const queryClient = useQueryClient();
  const { canAccess, loading: accessLoading } = useAccess();
  const pageUrl = menuUrlFor(pathname);
  const blocked = !accessLoading && !!pageUrl && !canAccess(pageUrl);
  useEffect(() => {
    if (!blocked) return;
    if (isForeman && canAccess("/externo/relatorio-diario")) {
      navigate({ to: "/externo/relatorio-diario", replace: true });
      return;
    }
    if (pathname === "/dashboard") {
      const first = MENU_GROUPS.flatMap((g) => g.items).find((i) => canAccess(i.url));
      if (first) navigate({ to: first.url, replace: true });
    }
  }, [isForeman, blocked, pathname, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-card/90 px-3 backdrop-blur">
            <SidebarTrigger />
            {isForeman ? (
              <span className="font-display text-sm uppercase tracking-widest">Relatório Diário</span>
            ) : (
              <Link to="/dashboard" className="font-display text-sm uppercase tracking-widest">
                Programação Operacional
              </Link>
            )}
            <div className="ml-auto flex items-center gap-3">
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {ROLE_LABEL[role]}
              </Badge>
              <span className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
                <User2 className="h-4 w-4" />
                {profile?.full_name || profile?.email}
              </span>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            {accessLoading ? null : blocked ? (
              <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Você não tem acesso a esta página. Fale com um administrador.
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

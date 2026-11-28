import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, User2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { RailMenu } from "@/components/nav/rail-menu";
import { MenuSearch } from "@/components/nav/menu-search";
import { NotificationsBell } from "@/components/nav/notifications-bell";
import { useMenuStyle } from "@/components/nav/menu-prefs";
import { ReloadButton, ThemeToggle } from "@/components/nav/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { menuUrlFor, MENU_GROUPS } from "@/lib/menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardWarmup } from "@/components/dashboard-warmup";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";

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
  const dashboardPending = useRouterState({ select: (r) => r.status === "pending" && r.location.pathname !== r.resolvedLocation?.pathname && ["/planejamento", "/funcionarios", "/atividades", "/frota", "/frota/"].includes(r.location.pathname) });
  const queryClient = useQueryClient();
  const { canAccess, loading: accessLoading } = useAccess();
  const pageUrl = menuUrlFor(pathname);
  const [menuStyle] = useMenuStyle();
  const rail = menuStyle === "rail";
  const blocked = !accessLoading && !!pageUrl && !canAccess(pageUrl);
  useEffect(() => {
    if (!blocked) return;
    if (isForeman && canAccess("/externo/relatorio-diario")) {
      navigate({ to: "/externo/relatorio-diario", replace: true });
      return;
    }
    if (pathname === "/dashboard" || pathname === "/programacao/diaria") {
      const first = MENU_GROUPS.flatMap((g) => g.items).find((i) => canAccess(i.url));
      if (first) navigate({ to: first.url, replace: true });
    }
  }, [isForeman, blocked, pathname, navigate]); // eslint-disable-line react-hooks/exhaustive-deps
  // Celular: dashboards (visão geral dos módulos) não abrem; vai para a 1ª página liberada do módulo.
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!isMobile || accessLoading) return;
    const p = pathname.replace(/\/$/, "") || "/";
    const g = MENU_GROUPS.find((m) => m.overview === p);
    if (!g) return;
    const first = g.items.find((i) => canAccess(i.url)) ?? MENU_GROUPS.flatMap((m) => m.items).find((i) => canAccess(i.url));
    if (first) navigate({ to: (first.to ?? first.url) as never, replace: true });
  }, [isMobile, accessLoading, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // Usuário sem acesso liberado (novo ou desativado): só a mensagem, sem menu nem páginas.
  if (profile && profile.active === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="font-display text-lg">Acesso ainda não liberado</h1>
          <p className="text-sm text-muted-foreground">
            Olá{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}! Seu cadastro foi recebido, mas você ainda não tem acesso ao sistema.
            Fale com o administrador do sistema para que os seus acessos sejam liberados.
          </p>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        {rail ? <RailMenu /> : <AppSidebar />}
        <MenuSearch />
        <div className={`flex min-w-0 flex-1 flex-col ${rail ? "pb-20 md:pb-0" : ""}`}>
          {/* Cabeçalho de vidro (mesmo liquid glass do menu) na largura toda; a página rola por baixo. */}
          <header className={`liquid-glass liquid-glass-bar sticky top-0 z-30 flex h-14 items-center gap-3 px-3 ${rail ? "md:pl-20" : ""}`}>
            {!rail && <SidebarTrigger />}
            {isForeman ? (
              <span className="font-display text-sm uppercase tracking-widest">Relatório Diário</span>
            ) : (
              <Link to="/programacao/diaria" className="font-display text-sm uppercase tracking-widest">
                Programação Operacional
              </Link>
            )}
            <div className="ml-auto flex items-center gap-3">
              <ReloadButton />
              <ThemeToggle />
              <NotificationsBell showMenuAlerts />
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
          <main className={`flex-1 p-4 md:p-6 ${rail ? "md:pl-[6.5rem]" : ""}`}>
            {accessLoading ? <DashboardSkeleton /> : blocked ? (
              <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Você não tem acesso a esta página. Fale com um administrador.
              </div>
            ) : (
              <>
                <DashboardWarmup />
                {dashboardPending && <DashboardSkeleton />}
                <div className={dashboardPending ? "hidden" : "contents"}><PageEnter><Outlet /></PageEnter></div>
              </>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Entrada suave a cada troca de página (sem remontar a página: só reinicia a animação). */
function PageEnter({ children }: { children: ReactNode }) {
  // Só depois que a página nova carregou (resolvedLocation): com location a animação reiniciava na página antiga
  // enquanto a nova ainda carregava, e a tela "piscava" na mesma aba antes de trocar.
  const path = useRouterState({ select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("page-enter");
    void el.offsetWidth; // reinicia a animação
    el.classList.add("page-enter");
  }, [path]);
  return <div ref={ref} className="page-enter">{children}</div>;
}

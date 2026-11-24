import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** Consultas dos avisos do menu (use-nav-badges, use-schedule-alerts, use-service-distribution) e das notificações (reserva do Realtime). */
const MENU_BADGE_KEYS = [["menu-badges"], ["schedule-alerts"], ["service-distribution"], ["client-onboarding"], ["notifications"]];

/** Login vencido (aba aberta muito tempo / computador dormiu): o Supabase responde "JWT expired". */
const isJwtExpired = (e: unknown) => {
  const x = e as { message?: string; code?: string } | null;
  return !!x && (x.code === "PGRST301" || /jwt expired/i.test(String(x.message ?? e)));
};
let refreshing: Promise<unknown> | null = null;
/** Renova o login uma vez (várias consultas falhando juntas esperam a mesma renovação). */
const refreshLogin = () => {
  if (typeof window === "undefined") return;
  refreshing ??= import("@/integrations/supabase/client")
    .then(({ supabase }) => supabase.auth.refreshSession())
    .catch(() => undefined)
    .finally(() => { setTimeout(() => { refreshing = null; }, 5000); });
};

export const getRouter = () => {
  // 30 s de cache: listas de apoio (clientes, obras...) não são relidas a cada tela; as gravações já invalidam o que mudam.
  // Depois de qualquer gravação (useMutation), os avisos do menu são relidos (agrupado em 1,5 s); antes só a cada 5 min.
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  const mutationCache = new MutationCache({
    onError: (e) => { if (isJwtExpired(e)) refreshLogin(); },
    onSettled: () => {
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        for (const queryKey of MENU_BADGE_KEYS) void queryClient.invalidateQueries({ queryKey });
      }, 1500);
    },
  });
  // Login vencido: renova a sessão e repete a consulta/gravação (a gravação foi recusada inteira, então repetir é seguro).
  const queryCache = new QueryCache({ onError: (e) => { if (isJwtExpired(e)) refreshLogin(); } });
  const jwtDelay = (n: number, e: unknown) => (isJwtExpired(e) ? 1500 : Math.min(1000 * 2 ** n, 30_000));
  const queryClient = new QueryClient({
    mutationCache,
    queryCache,
    defaultOptions: {
      queries: { staleTime: 30_000, retry: (n, e) => { if (isJwtExpired(e)) { refreshLogin(); return n < 2; } return n < 3; }, retryDelay: jwtDelay },
      mutations: { retry: (n, e) => { if (!isJwtExpired(e)) return false; refreshLogin(); return n < 2; }, retryDelay: jwtDelay },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Passar o mouse num link já baixa a página (código e dados da rota): a troca de aba fica imediata.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};

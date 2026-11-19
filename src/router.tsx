import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** Consultas dos avisos do menu (use-nav-badges, use-schedule-alerts, use-service-distribution). */
const MENU_BADGE_KEYS = [["menu-badges"], ["schedule-alerts"], ["service-distribution"], ["client-onboarding"]];

export const getRouter = () => {
  // 30 s de cache: listas de apoio (clientes, obras...) não são relidas a cada tela; as gravações já invalidam o que mudam.
  // Depois de qualquer gravação (useMutation), os avisos do menu são relidos (agrupado em 1,5 s); antes só a cada 5 min.
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  const mutationCache = new MutationCache({
    onSettled: () => {
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        for (const queryKey of MENU_BADGE_KEYS) void queryClient.invalidateQueries({ queryKey });
      }, 1500);
    },
  });
  const queryClient = new QueryClient({ mutationCache, defaultOptions: { queries: { staleTime: 30_000 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};

/**
 * Aquecimento dos dashboards: alguns segundos depois de entrar no sistema (e de novo a cada 25 min com a aba visível),
 * monta escondido, um de cada vez, cada dashboard que a pessoa pode abrir. As consultas são as mesmas da página
 * (mesmas chaves do React Query), então ao clicar no módulo o código e os dados já estão em memória e o dashboard
 * aparece na hora (as consultas velhas se atualizam por trás). Só monta o que passa no mesmo filtro de acesso da
 * página (senão a página redirecionaria) e nunca o dashboard que já está aberto.
 */
import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useAccess } from "@/hooks/use-access";
import { useCurrentUser } from "@/hooks/use-auth";
import { MENU_GROUPS } from "@/lib/menu";

const START_MS = 2500, REPEAT_MS = 25 * 60_000, MIN_MS = 3000, MAX_MS = 45_000;

export function DashboardWarmup() {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { canAccess, loading } = useAccess();
  const { role, loading: roleLoading } = useCurrentUser();
  const [current, setCurrent] = useState<{ path: string; C: ComponentType } | null>(null);
  const running = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (loading || roleLoading) return;
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const anyOf = (ov: string) => (MENU_GROUPS.find((g) => g.overview === ov)?.items ?? []).some((i) => canAccess(i.url));
    const list = [
      { path: "/planejamento", ok: anyOf("/planejamento") },
      { path: "/funcionarios", ok: anyOf("/funcionarios") },
      { path: "/atividades", ok: role === "admin" || role === "coordenador" },
      { path: "/frota", ok: anyOf("/frota") },
      { path: "/financeiro", ok: canAccess("/fechamentos/financeiro") },
    ].filter((x) => x.ok).map((x) => x.path);
    if (!list.length) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const run = async () => {
      if (running.current || document.visibilityState !== "visible") return;
      running.current = true;
      try {
        for (const path of list) {
          if (cancelled) break;
          if (pathRef.current === path || pathRef.current === `${path}/`) continue;
          const route = (router.routesByPath as Record<string, any>)[path];
          if (!route) continue;
          try { await router.loadRouteChunk(route); } catch { continue; }
          const C = route.options.component as ComponentType | undefined;
          if (!C || cancelled) continue;
          setCurrent({ path, C });
          // Espera as consultas assentarem (mínimo 3 s, máximo 45 s) e desmonta; os dados ficam no cache.
          const t0 = Date.now();
          let quiet = 0;
          while (!cancelled && Date.now() - t0 < MAX_MS) {
            await wait(1000);
            quiet = qc.isFetching() === 0 ? quiet + 1 : 0;
            if (Date.now() - t0 >= MIN_MS && quiet >= 2) break;
          }
          setCurrent(null);
          await wait(300);
        }
      } finally { running.current = false; }
    };
    const first = setTimeout(() => void run(), START_MS);
    const again = setInterval(() => void run(), REPEAT_MS);
    return () => { cancelled = true; clearTimeout(first); clearInterval(again); setCurrent(null); };
  }, [loading, roleLoading, role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const { C } = current;
  return (
    <div aria-hidden="true" inert
      style={{ position: "fixed", left: -20000, top: 0, width: 1600, height: 900, overflow: "hidden", visibility: "hidden", pointerEvents: "none", contain: "strict" }}>
      <Suspense fallback={null}><C /></Suspense>
    </div>
  );
}

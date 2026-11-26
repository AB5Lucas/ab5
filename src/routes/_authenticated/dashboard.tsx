import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";

// Entrada do sistema (login e "/"): dashboard do primeiro módulo liberado (menos Atividades); sem nenhum, a primeira página liberada.
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "AB5 Hub" }, { name: "description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:title", content: "AB5 Hub" }, { property: "og:description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Landing,
});

function Landing() {
  const { canAccess, loading } = useAccess();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    // Abre o dashboard do primeiro módulo (ordem do menu) em que a pessoa acessa alguma página; Atividades fica de fora.
    const dash = MENU_GROUPS.find((g) => g.overview && g.overview !== "/atividades" && !g.userMenu && g.items.some((i) => canAccess(i.url)));
    if (dash?.overview) { navigate({ to: dash.overview as never, replace: true }); return; }
    const first = MENU_GROUPS.flatMap((g) => g.items).find((i) => canAccess(i.url));
    if (first) navigate({ to: (first.to ?? first.url) as never, replace: true });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
}

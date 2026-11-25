import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";

// Entrada do sistema (login e "/"): quem acessa a Programação abre o dashboard do Planejamento; os demais, a primeira página liberada na ordem do menu.
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "AB5 Hub" }, { name: "description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:title", content: "AB5 Hub" }, { property: "og:description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Landing,
});

function Landing() {
  const { canAccess, loading } = useAccess();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    // Quem acessa a Programação entra no dashboard do Planejamento.
    if (canAccess("/programacao/diaria")) { navigate({ to: "/planejamento", replace: true }); return; }
    const first = MENU_GROUPS.flatMap((g) => g.items).find((i) => canAccess(i.url));
    if (first) navigate({ to: (first.to ?? first.url) as never, replace: true });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
}

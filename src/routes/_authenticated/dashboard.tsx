import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";

// Entrada do sistema (login e "/"): leva à primeira página liberada do usuário, na ordem do menu (as visões gerais dos módulos não são a entrada).
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "AB5 Hub" }, { name: "description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:title", content: "AB5 Hub" }, { property: "og:description", content: "Abrindo sua primeira página no AB5 Hub." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Landing,
});

function Landing() {
  const { canAccess, loading } = useAccess();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    const first = MENU_GROUPS.flatMap((g) => g.items).find((i) => canAccess(i.url));
    if (first) navigate({ to: (first.to ?? first.url) as never, replace: true });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
}

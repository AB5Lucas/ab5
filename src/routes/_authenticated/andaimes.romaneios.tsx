import { createFileRoute, redirect } from "@tanstack/react-router";

// Romaneios agora fazem parte do fluxo da solicitação
export const Route = createFileRoute("/_authenticated/andaimes/romaneios")({
  beforeLoad: () => {
    throw redirect({ to: "/andaimes/solicitacoes" });
  },
});

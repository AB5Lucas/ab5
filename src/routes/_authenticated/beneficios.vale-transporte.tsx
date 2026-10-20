import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada para Premiações (sub aba); mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/beneficios/vale-transporte")({
  beforeLoad: () => {
    throw redirect({ to: "/fechamento", search: { tab: "vale-transporte" } });
  },
});

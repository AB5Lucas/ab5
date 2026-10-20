import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada para Premiações (sub aba); mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/beneficios/premio-viagem")({
  beforeLoad: () => {
    throw redirect({ to: "/fechamento", search: { tab: "premio-viagem" } });
  },
});

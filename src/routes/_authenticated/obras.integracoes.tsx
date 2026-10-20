import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada como sub aba de Controles; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/obras/integracoes")({
  beforeLoad: () => {
    throw redirect({ to: "/agendamentos", search: { tab: "integracoes" } });
  },
});

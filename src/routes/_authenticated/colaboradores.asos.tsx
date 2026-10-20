import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada como sub aba de Controles; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/colaboradores/asos")({
  beforeLoad: () => {
    throw redirect({ to: "/agendamentos", search: { tab: "asos" } });
  },
});

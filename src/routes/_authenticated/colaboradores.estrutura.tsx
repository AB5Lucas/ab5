import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada como sub aba de Colaboradores; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/colaboradores/estrutura")({
  beforeLoad: () => {
    throw redirect({ to: "/colaboradores", search: { tab: "funcoes" } });
  },
});

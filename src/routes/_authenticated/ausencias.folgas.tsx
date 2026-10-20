import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada como sub aba de Ausências; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/ausencias/folgas")({
  beforeLoad: () => {
    throw redirect({ to: "/ausencias", search: {} });
  },
});

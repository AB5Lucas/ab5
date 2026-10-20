import { createFileRoute, redirect } from "@tanstack/react-router";

// Página realocada como sub aba de Transporte; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/veiculos/")({
  beforeLoad: () => {
    throw redirect({ to: "/veiculos/transporte", search: { tab: "frota" } });
  },
});

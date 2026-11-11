import { createFileRoute, redirect } from "@tanstack/react-router";

// Relatórios virou Frota › Custos; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/veiculos/relatorios")({
  beforeLoad: () => {
    throw redirect({ to: "/frota/custos" });
  },
});

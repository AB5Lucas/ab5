import { createFileRoute, redirect } from "@tanstack/react-router";

// Relatórios virou a sub aba Custos de Transporte; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/veiculos/relatorios")({
  beforeLoad: () => {
    throw redirect({ to: "/veiculos/transporte", search: { tab: "custos" } });
  },
});

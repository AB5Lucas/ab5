import { createFileRoute, redirect } from "@tanstack/react-router";

// Relatórios virou a sub aba Manutenção de Transporte; mantém links antigos funcionando.
export const Route = createFileRoute("/_authenticated/veiculos/relatorios")({
  beforeLoad: () => {
    throw redirect({ to: "/veiculos/transporte", search: { tab: "manutencao" } });
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { FleetMaintenancePage } from "@/components/veiculos/manutencao";

export const Route = createFileRoute("/_authenticated/frota/custos")({
  head: () => ({ meta: [{ title: "Custos | Frota | AB5 Hub" }, { name: "description", content: "Custo real x orçado da frota: combustível, manutenção, pedágio e locação." }] }),
  component: FleetMaintenancePage,
});

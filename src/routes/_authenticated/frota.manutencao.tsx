import { createFileRoute } from "@tanstack/react-router";
import { FleetServicePage } from "@/components/frota/manutencao";

export const Route = createFileRoute("/_authenticated/frota/manutencao")({
  head: () => ({ meta: [{ title: "Manutenção | Frota | AB5 Hub" }, { name: "description", content: "Revisões preventivas por veículo, pelo km das notas do posto." }] }),
  component: FleetServicePage,
});

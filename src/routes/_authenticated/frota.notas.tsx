import { createFileRoute } from "@tanstack/react-router";
import { FleetNotesPage } from "@/components/frota/notas";

export const Route = createFileRoute("/_authenticated/frota/notas")({
  head: () => ({ meta: [{ title: "Abastecimento | Frota | AB5 Hub" }, { name: "description", content: "Abastecimentos do posto: conferência das notas, rateio, centro de custo e aprovação." }] }),
  component: FleetNotesPage,
});

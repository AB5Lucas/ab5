import { createFileRoute } from "@tanstack/react-router";
import { AbsenceManager } from "@/components/absence-manager";

export const Route = createFileRoute("/_authenticated/ausencias/ferias")({
  head: () => ({
    meta: [
      { title: "Férias | Programação Operacional" },
      { name: "description", content: "Períodos de férias programados e em curso por colaborador." },
      { property: "og:title", content: "Férias | Programação Operacional" },
      { property: "og:description", content: "Períodos de férias programados e em curso por colaborador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AbsenceManager
      table="vacations"
      mode="period"
      title="Férias"
      description="Períodos de férias programados e em curso por colaborador."
      addLabel="Lançar férias"
    />
  ),
});

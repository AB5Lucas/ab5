import { createFileRoute } from "@tanstack/react-router";
import { AbsenceManager } from "@/components/absence-manager";

export const Route = createFileRoute("/_authenticated/ausencias/folgas")({
  head: () => ({
    meta: [
      { title: "Folgas | Programação Operacional" },
      { name: "description", content: "Folgas pontuais concedidas aos colaboradores por data." },
      { property: "og:title", content: "Folgas | Programação Operacional" },
      { property: "og:description", content: "Folgas pontuais concedidas aos colaboradores por data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AbsenceManager
      table="days_off"
      mode="single"
      title="Folgas"
      description="Folgas pontuais concedidas aos colaboradores por data."
      extraFieldLabel="Motivo"
      extraFieldName="reason"
      addLabel="Lançar folga"
    />
  ),
});

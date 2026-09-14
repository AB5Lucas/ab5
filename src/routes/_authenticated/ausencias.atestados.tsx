import { createFileRoute } from "@tanstack/react-router";
import { AbsenceManager } from "@/components/absence-manager";

export const Route = createFileRoute("/_authenticated/ausencias/atestados")({
  head: () => ({
    meta: [
      { title: "Atestados | Programação Operacional" },
      { name: "description", content: "Atestados médicos e períodos de afastamento dos colaboradores." },
      { property: "og:title", content: "Atestados | Programação Operacional" },
      { property: "og:description", content: "Atestados médicos e períodos de afastamento dos colaboradores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AbsenceManager
      table="medical_leaves"
      mode="period"
      title="Atestados"
      description="Atestados médicos e períodos de afastamento dos colaboradores."
      extraFieldLabel="Link do documento"
      extraFieldName="document_url"
      addLabel="Lançar atestado"
    />
  ),
});

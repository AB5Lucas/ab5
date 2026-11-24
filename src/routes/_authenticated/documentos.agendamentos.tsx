import { createFileRoute } from "@tanstack/react-router";
import { AppointmentsPage } from "@/components/controles/agendamentos";
import { DocsInsights } from "@/components/insights/docs-insights";

type Search = { dia?: string; treinamento?: string };

export const Route = createFileRoute("/_authenticated/documentos/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos | AB5 Hub" }, { name: "description", content: "Agendamentos de ASO, treinamentos e integrações: confirme a realização ou reagende." }] }),
  // dia/treinamento: opcionais, usados pelos blocos vivos (Turmas se formando abre a lista já filtrada).
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["dia"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["dia"]) ? { dia: s["dia"] } : {}),
    ...(typeof s["treinamento"] === "string" && s["treinamento"] ? { treinamento: s["treinamento"] } : {}),
  }),
  component: Page,
});

function Page() {
  const { dia, treinamento } = Route.useSearch();
  return (
    <div className="space-y-4">
      <DocsInsights />
      <AppointmentsPage key={`${dia ?? ""}|${treinamento ?? ""}`} initialDay={dia} initialTrainingId={treinamento} />
    </div>
  );
}

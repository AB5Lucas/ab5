import { createFileRoute } from "@tanstack/react-router";
import { AppointmentsPage } from "@/components/controles/agendamentos";

export const Route = createFileRoute("/_authenticated/documentos/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos | AB5 Hub" }, { name: "description", content: "Agendamentos de ASO, treinamentos e integrações: confirme a realização ou reagende." }] }),
  component: AppointmentsPage,
});

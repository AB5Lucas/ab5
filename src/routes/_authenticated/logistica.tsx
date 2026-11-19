import { createFileRoute } from "@tanstack/react-router";
import { LogisticaPage } from "@/components/logistica/logistica-page";

export const Route = createFileRoute("/_authenticated/logistica")({
  head: () => ({ meta: [{ title: "Logística | AB5 Hub" }, { name: "description", content: "Demandas de carga, descarga e busca de material: veículo sugerido, programação, alertas e mensagem ao motorista." }] }),
  component: LogisticaPage,
});

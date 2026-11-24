import { createFileRoute } from "@tanstack/react-router";
import { ResultadoPage } from "@/components/resultado-page";

export const Route = createFileRoute("/_authenticated/obras/resultado")({
  head: () => ({
    meta: [
      { title: "Resultados | AB5 Hub" },
      { name: "description", content: "Margem de contribuição proporcional ao andamento de cada serviço." },
      { property: "og:title", content: "Resultados | AB5 Hub" },
      { property: "og:description", content: "Receita proporcional, custo realizado e margem por serviço." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?work=<id> abre já no serviço (clique no nome do serviço em Clientes › Serviços).
  validateSearch: (s: Record<string, unknown>): { work?: string } => (typeof s["work"] === "string" && s["work"] ? { work: s["work"] } : {}),
  component: ResultadoRoute,
});

function ResultadoRoute() {
  const { work } = Route.useSearch();
  return <ResultadoPage key={work ?? ""} {...(work ? { initialWorkId: work } : {})} />;
}

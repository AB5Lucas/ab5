import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, ComingSoon } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios | Programação Operacional" },
      { name: "description", content: "Relatórios operacionais e exportação." },
      { property: "og:title", content: "Relatórios | Programação Operacional" },
      { property: "og:description", content: "Relatórios operacionais e exportação." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-2">
      <PageHeader title="Relatórios" description="Relatórios operacionais e exportação." />
      <ComingSoon phase="Fase 9" />
    </div>
  );
}

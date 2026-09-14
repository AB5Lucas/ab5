import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, ComingSoon } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Programação Operacional" },
      { name: "description", content: "Feriados, parâmetros e preferências do sistema." },
      { property: "og:title", content: "Configurações | Programação Operacional" },
      { property: "og:description", content: "Feriados, parâmetros e preferências do sistema." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-2">
      <PageHeader title="Configurações" description="Feriados, parâmetros e preferências do sistema." />
      <ComingSoon phase="Fase 9" />
    </div>
  );
}

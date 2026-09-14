import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, ComingSoon } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria | Programação Operacional" },
      { name: "description", content: "Registro de alterações importantes do sistema." },
      { property: "og:title", content: "Auditoria | Programação Operacional" },
      { property: "og:description", content: "Registro de alterações importantes do sistema." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-2">
      <PageHeader title="Auditoria" description="Registro de alterações importantes do sistema." />
      <ComingSoon phase="Fase 9" />
    </div>
  );
}

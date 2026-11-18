import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { HolidaysSettings } from "@/components/holidays-settings";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Programação Operacional" },
      { name: "description", content: "Feriados do calendário operacional e informações gerais do sistema." },
      { property: "og:title", content: "Configurações | Programação Operacional" },
      { property: "og:description", content: "Feriados do calendário operacional e informações gerais do sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { canWrite } = useCurrentUser();
  const counts = useQuery({
    queryKey: ["system-counts"],
    queryFn: async () => {
      const tables = ["collaborators", "works", "vehicles", "trainings"] as const;
      const results = await Promise.all(
        tables.map((t) => supabase.from(t).select("id", { count: "exact", head: true })),
      );
      return {
        collaborators: results[0]?.count ?? 0,
        works: results[1]?.count ?? 0,
        vehicles: results[2]?.count ?? 0,
        trainings: results[3]?.count ?? 0,
      };
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Configurações"
        description="Calendário de feriados e visão geral dos cadastros do sistema."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Colaboradores" value={counts.data?.collaborators ?? 0} />
        <Stat label="Obras" value={counts.data?.works ?? 0} />
        <Stat label="Veículos" value={counts.data?.vehicles ?? 0} />
        <Stat label="Treinamentos" value={counts.data?.trainings ?? 0} />
      </div>

      <div className="panel space-y-4 p-4">
        <div>
          <h2 className="font-display text-lg uppercase tracking-wide">Feriados</h2>
          <p className="text-sm text-muted-foreground">
            Feriado vale para todos (destacado na Programação, fora do Fechamento e com hora 100% no custo); exceções por cliente ajustam só aquele cliente.
          </p>
        </div>

        <HolidaysSettings canWrite={canWrite} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

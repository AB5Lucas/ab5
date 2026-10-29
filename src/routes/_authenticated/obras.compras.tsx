import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/obras/compras")({
  head: () => ({
    meta: [
      { title: "Compras | AB5 Hub" },
      { name: "description", content: "Despesas de compras por centro de custo lançadas nos serviços." },
      { property: "og:title", content: "Compras | AB5 Hub" },
      { property: "og:description", content: "Despesas de compras por centro de custo lançadas nos serviços." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComprasPage,
});

function ComprasPage() {
  const progress = useQuery({
    queryKey: ["cc-progress"],
    queryFn: async () => {
      const [c, w] = await Promise.all([
        supabase.from("clients").select("id, cc_prefix"),
        supabase.from("works").select("id, cc_suffix").eq("active", true),
      ]);
      if (c.error) throw c.error;
      if (w.error) throw w.error;
      return {
        clients: c.data.length,
        clientsDone: c.data.filter((x) => x.cc_prefix).length,
        works: w.data.length,
        worksDone: w.data.filter((x) => x.cc_suffix).length,
      };
    },
  });
  const p = progress.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Compras"
        description="Despesas da planilha de Compras (pasta Compras/RELATÓRIOS) lançadas nos serviços pelo centro de custo."
        actions={
          <Button size="sm" disabled title="Liberado após o preenchimento dos centros de custo">
            <RefreshCw className="h-4 w-4" /> Sincronizar
          </Button>
        }
      />
      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="font-medium">Preenchimento dos centros de custo</p>
        <p className="mt-1 text-muted-foreground">
          Clientes com Prefixo CC: {p ? `${p.clientsDone} de ${p.clients}` : "…"} · Serviços ativos com Sufixo CC:{" "}
          {p ? `${p.worksDone} de ${p.works}` : "…"}
        </p>
        <p className="mt-2 text-muted-foreground">
          Preencha em <Link to="/obras" className="underline">Cadastros</Link>. Nenhuma compra é lançada até você clicar em Sincronizar.
        </p>
      </div>
    </div>
  );
}

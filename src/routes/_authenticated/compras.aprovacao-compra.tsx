import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScTable, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";
import { FA_DIRECTOR, FA_VITORIA, RecommendationView } from "@/components/compras/recommendation-view";
import { recCols, useRecTotals } from "@/components/compras/rec-list";

export const Route = createFileRoute("/_authenticated/compras/aprovacao-compra")({
  validateSearch: (s: Record<string, unknown>) => ({ sc: typeof s["sc"] === "string" ? s["sc"] : undefined }),
  head: () => ({ meta: [{ title: "Aprovação de Compras | AB5 Hub" }, { name: "description", content: "Recomendações de compra enviadas pelo comprador para aprovação." }] }),
  component: Page,
});

type View = "pendentes" | "ciencia" | "decididas" | "todas";

/**
 * Aprovação final da compra (depois da Recomendação do comprador). Marcelo, admin e quem compra veem todas;
 * Vitória as dentro da verba e as de aprovação dupla; o gestor só as de aprovação dupla dos clientes dele.
 */
function Page() {
  const { user, role } = useCurrentUser();
  const { canAccess } = useAccess();
  const uid = user?.id ?? "";
  const navigate = useNavigate({ from: Route.fullPath });
  const { sc } = Route.useSearch();
  const [view, setView] = useState<View>("pendentes");
  const list = useScRequests("final-approval", (q) => q.not("fa_state", "is", null));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const seesAll = uid === FA_DIRECTOR || role === "admin" || canAccess("/compras/comprador");
  // Gestor (cadastro do cliente: gestor/substituto, ou o validador da SC): só as SCs dos clientes dele.
  const gestorIds = useQuery({
    queryKey: ["fa-gestor-ids", uid],
    enabled: !!uid,
    queryFn: async () => new Set(((await supabase.rpc("purchase_fa_my_gestor_ids" as never)).data as unknown as string[] | null) ?? []),
  });
  const mine = (list.data ?? []).filter((r) => {
    if (seesAll) return true;
    if (uid === FA_VITORIA) return true;
    return gestorIds.data?.has(r.id) || r.fa_decided_by === uid || r.fa_partial_by === uid;
  });
  const by: Record<View, (r: ScRow) => boolean> = {
    pendentes: (r) => r.fa_state === "em_aprovacao",
    ciencia: (r) => !!r.fa_ack_needed,
    decididas: (r) => r.fa_state === "aprovada" || r.fa_state === "recusada",
    todas: () => true,
  };
  const rows = mine.filter(by[view]);
  const totals = useRecTotals(rows);
  const open = (id: string | undefined) => navigate({ search: { sc: id }, replace: !id });

  if (sc) return <RecommendationView requestId={sc} mode="aprovacao" isGestor={!!gestorIds.data?.has(sc)} onBack={() => open(undefined)} />;
  const count = (v: View) => mine.filter(by[v]).length;
  return (
    <div className="space-y-4">
      <PageHeader title="Aprovação" description="Recomendações de compra enviadas pelo comprador. Abra a SC, escolha Aprovado ou Recusado e envie de volta ao comprador." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="block text-xs">Mostrar</Label>
          <Select value={view} onValueChange={(v) => setView(v as View)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Em aprovação ({count("pendentes")})</SelectItem>
              <SelectItem value="ciencia">Aguardando ciência do Marcelo ({count("ciencia")})</SelectItem>
              <SelectItem value="decididas">Aprovadas/recusadas ({count("decididas")})</SelectItem>
              <SelectItem value="todas">Todas ({count("todas")})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Compras acima da verba com prazo em até 2 dias: aprovação dupla (Comprador + Gestor; depois a ciência do Marcelo)
        </p>
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={rows} clientName={clientName} extraCols={recCols(totals, true)} actions={(r) => (
          <Button size="sm" variant="outline" onClick={() => open(r.id)}><Eye className="h-3.5 w-3.5" /> Abrir</Button>
        )} />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ScHeaderDialog, ScTable, StatusFilter, statusCounts, useClientsList, useScRequests } from "@/components/compras/sc-shared";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/")({
  head: () => ({ meta: [{ title: "Solicitações de Compra | AB5 Hub" }, { name: "description", content: "Minhas solicitações de compra, status e envio para aprovação." }] }),
  component: Page,
});

/** Visão do solicitante: só as SCs dele, filtro de status e o botão Enviar (vai para o aprovador). */
function Page() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const list = useScRequests(`mine-${user?.id ?? ""}`, (q) => q.eq("requester_id", user?.id ?? "00000000-0000-0000-0000-000000000000"));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const rows = (list.data ?? []).filter((r) => status === "all" || r.status === status);
  const send = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("purchase_request_send", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Enviada para o aprovador"); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Suas solicitações de compra. Enviar manda para o seu aprovador; depois de aprovada, vai para Compras." />
      <div className="flex flex-wrap items-end gap-3">
        <StatusFilter value={status} onChange={setStatus} counts={statusCounts(list.data ?? [])} />
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova</Button>
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={rows} clientName={clientName} showRequester={false} actions={(r) => r.stage === "rascunho" ? (
          <Button size="sm" disabled={send.isPending} onClick={() => send.mutate(r.id)}><Send className="h-3.5 w-3.5" /> Enviar</Button>
        ) : null} />
      )}
      <ScHeaderDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Plus, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScHeaderDialog, ScRemoveDialog, ScTable, StatusFilter, statusCounts, useClientsList, useScRemove, useScRequests, type ScRow } from "@/components/compras/sc-shared";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/")({
  head: () => ({ meta: [{ title: "Solicitações de Compra | AB5 Hub" }, { name: "description", content: "Minhas solicitações de compra, status e envio para aprovação." }] }),
  component: Page,
});

/** Visão do solicitante: as SCs dele e as que tem em cópia (observador), filtro de status, Enviar, Apagar (não enviada) e Cancelar (enviada). */
type Scope = "todas" | "minhas" | "copia";
function Page() {
  const { user, isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState<Scope>("todas");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ScRow | null>(null);
  const uid = user?.id ?? "00000000-0000-0000-0000-000000000000";
  // Administrador vê todas as SCs (a RLS libera); os demais, as próprias e as em cópia.
  const list = useScRequests(`mine-${uid}-${isAdmin}`, (q) => (isAdmin ? q : q.or(`requester_id.eq.${uid},observer_ids.cs.{${uid}}`)));
  const mine = (list.data ?? []).filter((r) => r.requester_id === uid);
  const copied = (list.data ?? []).filter((r) => r.requester_id !== uid && (r.observer_ids ?? []).includes(uid));
  const scoped = scope === "minhas" ? mine : scope === "copia" ? copied : list.data ?? [];
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const rows = scoped.filter((r) => status === "all" || r.status === status);
  const send = useMutation({
    mutationFn: async (id: string) => { const { data, error } = await supabase.rpc("purchase_request_send", { _id: id }); if (error) throw error; return data; },
    onSuccess: (to) => { toast.success(to === "compras" ? "Enviada direto para o Comprador" : "Enviada para o autorizante"); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useScRemove(() => setRemoving(null));
  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Suas solicitações e as que você acompanha em cópia. Enviar manda para o autorizante (gestor do cliente); depois de autorizada, vai para o Comprador. Enviada, só volta a ser editável se o autorizante ou o Comprador devolver." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="block text-xs">Acompanhar</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{isAdmin ? "Todas do sistema" : "Todas"} ({(list.data ?? []).length})</SelectItem>
              <SelectItem value="minhas">Feitas por mim ({mine.length})</SelectItem>
              <SelectItem value="copia">Em cópia (observador) ({copied.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <StatusFilter value={status} onChange={setStatus} counts={statusCounts(scoped)} />
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova</Button>
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={rows} clientName={clientName} showRequester={scope !== "minhas"} actions={(r) => r.requester_id !== uid ? null : r.stage === "rascunho" ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" disabled={send.isPending} onClick={() => send.mutate(r.id)}><Send className="h-3.5 w-3.5" /> Enviar</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Apagar" aria-label="Apagar solicitação" onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ) : r.stage === "aprovacao" || r.stage === "compras" ? (
          <Button size="sm" variant="outline" onClick={() => setRemoving(r)}><Ban className="h-3.5 w-3.5" /> Cancelar</Button>
        ) : null} />
      )}
      <ScHeaderDialog open={creating} onOpenChange={setCreating} />
      <ScRemoveDialog row={removing} onClose={() => setRemoving(null)} pending={remove.isPending} onConfirm={(r) => remove.mutate(r)} />
    </div>
  );
}

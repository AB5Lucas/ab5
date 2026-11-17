import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, Send, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScHeaderDialog, ScTable, StatusFilter, statusCounts, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/")({
  head: () => ({ meta: [{ title: "Solicitações de Compra | AB5 Hub" }, { name: "description", content: "Minhas solicitações de compra e as que aguardam a minha aprovação." }] }),
  component: Page,
});

type View = "minhas" | "aprovacoes";

/**
 * Solicitante: só as SCs dele, filtro de status e Enviar (vai para o aprovador).
 * Aprovador: "Minhas aprovações" mostra as SCs enviadas pelas pessoas ligadas a ele, para aprovar ou devolver.
 */
function Page() {
  const { user, isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("minhas");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const uid = user?.id ?? "00000000-0000-0000-0000-000000000000";
  // É aprovador de alguém (aba Aprovadores, no Comprador)?
  const approves = useQuery({
    queryKey: ["sc-i-approve", uid],
    queryFn: async () => (await supabase.from("purchase_approvers").select("requester_id").eq("approver_id", uid)).data?.map((x) => x.requester_id) ?? [],
  });
  const isApprover = isAdmin || (approves.data?.length ?? 0) > 0;
  const mine = useScRequests(`mine-${uid}`, (q) => q.eq("requester_id", uid));
  const pending = useScRequests(`approval-${uid}`, (q) => q.eq("stage", "aprovacao").neq("requester_id", uid));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const base = view === "minhas" ? mine.data ?? [] : (pending.data ?? []).filter((r) => isAdmin || approves.data?.includes(r.requester_id));
  const rows = view === "minhas" ? base.filter((r) => status === "all" || r.status === status) : base;

  const send = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("purchase_request_send", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Enviada para o aprovador"); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [deciding, setDeciding] = useState<{ row: ScRow; approve: boolean } | null>(null);
  const [notes, setNotes] = useState("");
  const decide = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_decide", { _id: deciding!.row.id, _approve: deciding!.approve, _notes: notes });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(deciding?.approve ? "Aprovada e enviada para o Comprador" : "Devolvida ao solicitante"); setDeciding(null); setNotes(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pendingCount = (pending.data ?? []).filter((r) => isAdmin || approves.data?.includes(r.requester_id)).length;
  const loading = view === "minhas" ? mine.isLoading : pending.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Suas solicitações de compra. Enviar manda para o seu aprovador; depois de aprovada, vai para o Comprador." />
      <div className="flex flex-wrap items-end gap-3">
        {isApprover && (
          <div className="space-y-1">
            <Label className="text-xs">Visão</Label>
            <Select value={view} onValueChange={(v) => setView(v as View)}>
              <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minhas">Minhas solicitações</SelectItem>
                <SelectItem value="aprovacoes">Minhas aprovações ({pendingCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {view === "minhas" && <StatusFilter value={status} onChange={setStatus} counts={statusCounts(mine.data ?? [])} />}
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova</Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : view === "minhas" ? (
        <ScTable rows={rows} clientName={clientName} showRequester={false} actions={(r) => r.stage === "rascunho" ? (
          <Button size="sm" disabled={send.isPending} onClick={() => send.mutate(r.id)}><Send className="h-3.5 w-3.5" /> Enviar</Button>
        ) : null} />
      ) : (
        <ScTable rows={rows} clientName={clientName} actions={(r) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}><Check className="h-3.5 w-3.5" /> Aprovar</Button>
            <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, approve: false })}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
          </div>
        )} />
      )}
      <ScHeaderDialog open={creating} onOpenChange={setCreating} />
      <Dialog open={!!deciding} onOpenChange={(o) => { if (!o) { setDeciding(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.approve ? "Aprovar solicitação" : "Devolver ao solicitante"}</DialogTitle>
            <DialogDescription>{deciding?.row.number} · clique no número na lista para ver os itens antes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="appr-notes">{deciding?.approve ? "Observação (opcional)" : "Motivo da devolução"}</Label>
            <Textarea id="appr-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancelar</Button>
            <Button disabled={decide.isPending} onClick={() => decide.mutate()}>{deciding?.approve ? "Aprovar" : "Devolver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

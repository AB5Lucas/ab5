import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScTable, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";

export const Route = createFileRoute("/_authenticated/compras/aprovacao")({
  head: () => ({ meta: [{ title: "Aprovação de Compras | AB5 Hub" }, { name: "description", content: "Solicitações de compra aguardando a sua aprovação." }] }),
  component: Page,
});

/** Aprovador: SCs enviadas pelos solicitantes ligados a ele (aba Aprovadores). Aprova (vai para Compras) ou devolve. */
function Page() {
  const qc = useQueryClient();
  const list = useScRequests("approval", (q) => q.eq("stage", "aprovacao"));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const [deciding, setDeciding] = useState<{ row: ScRow; approve: boolean } | null>(null);
  const [notes, setNotes] = useState("");
  const decide = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_decide", { _id: deciding!.row.id, _approve: deciding!.approve, _notes: notes });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(deciding?.approve ? "Aprovada e enviada para Compras" : "Devolvida ao solicitante"); setDeciding(null); setNotes(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Aprovação" description="Solicitações enviadas pelos solicitantes que você aprova. Clique no número para ver os itens." />
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={list.data ?? []} clientName={clientName} actions={(r) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}><Check className="h-3.5 w-3.5" /> Aprovar</Button>
            <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, approve: false })}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
          </div>
        )} />
      )}
      <Dialog open={!!deciding} onOpenChange={(o) => { if (!o) { setDeciding(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.approve ? "Aprovar solicitação" : "Devolver ao solicitante"}</DialogTitle>
            <DialogDescription>{deciding?.row.number}</DialogDescription>
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

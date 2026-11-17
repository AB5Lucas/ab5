import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApproversPanel } from "@/components/compras/approvers";
import { Pill, ScTable, StatusFilter, statusCounts, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";
import { SC_STATUSES, statusClass } from "@/lib/purchase-requests";

export const Route = createFileRoute("/_authenticated/compras/comprador")({
  head: () => ({ meta: [{ title: "Comprador | AB5 Hub" }, { name: "description", content: "Solicitações de compra aprovadas, para o comprador tratar." }] }),
  component: Page,
});

/** Comprador: só chegam as SCs já aprovadas. Muda o status (a data do status é a do dia) e escreve a observação. */
function Page() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const list = useScRequests("buyer", (q) => q.eq("stage", "compras"));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const rows = (list.data ?? []).filter((r) => status === "all" || r.status === status);
  const [edit, setEdit] = useState<ScRow | null>(null);
  const [form, setForm] = useState({ status: "", notes: "" });
  const [returning, setReturning] = useState<ScRow | null>(null);
  const [reason, setReason] = useState("");
  const giveBack = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_return", { _id: returning!.id, _notes: reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Devolvida ao solicitante"); setReturning(null); setReason(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_set_status", { _id: edit!.id, _status: form.status, _notes: form.notes });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status atualizado"); setEdit(null); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Comprador" description="Solicitações autorizadas (e as do TOTVS). Clique no número para ver e tratar os itens; Devolver manda de volta ao solicitante para editar." />
      <Tabs pageTabs defaultValue="solicitacoes">
        <TabsList>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="aprovadores">Autorizantes</TabsTrigger>
        </TabsList>
        <TabsContent value="solicitacoes" className="mt-4 space-y-4">
          <StatusFilter value={status} onChange={setStatus} counts={statusCounts(list.data ?? [])} />
          {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
            <ScTable rows={rows} clientName={clientName} actions={(r) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEdit(r); setForm({ status: r.status, notes: r.buyer_notes ?? "" }); }}><Pencil className="h-3.5 w-3.5" /> Status</Button>
                <Button size="sm" variant="ghost" title="Devolver ao solicitante para corrigir" onClick={() => { setReturning(r); setReason(""); }}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
              </div>
            )} />
          )}
        </TabsContent>
        <TabsContent value="aprovadores" className="mt-4"><ApproversPanel /></TabsContent>
      </Tabs>
      <Dialog open={!!returning} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver ao solicitante</DialogTitle>
            <DialogDescription>{returning?.number}. Ela volta para o solicitante editar e enviar de novo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="ret-notes">Motivo da devolução</Label>
            <Textarea id="ret-notes" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>Cancelar</Button>
            <Button disabled={giveBack.isPending || !reason.trim()} onClick={() => giveBack.mutate()}>Devolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Status da solicitação</DialogTitle>
            <DialogDescription>{edit?.number}. A data do status passa a ser a de hoje quando o status muda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">{SC_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}><Pill className={statusClass(s.value)}>{s.value}</Pill></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="buyer-notes">Observação do comprador</Label>
              <Textarea id="buyer-notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

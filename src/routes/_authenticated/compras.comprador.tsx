import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Pencil, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApproversPanel } from "@/components/compras/approvers";
import { ScReportButton } from "@/components/compras/sc-report-dialog";
import { Pill, ScTable, todayISO, StatusFilter, statusCounts, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";
import { SC_DONE_STATUSES, SC_STATUSES, statusClass } from "@/lib/purchase-requests";
import { PurchaseInsights, flowStage } from "@/components/insights/purchase-insights";
import { FLOW_LABEL, type FlowStage } from "@/lib/insights/purchases";

export const Route = createFileRoute("/_authenticated/compras/comprador")({
  head: () => ({ meta: [{ title: "Comprador | AB5 Hub" }, { name: "description", content: "Solicitações de compra aprovadas, para o comprador tratar." }] }),
  component: Page,
});

/** Comprador: só chegam as SCs já aprovadas. Muda o status (a data do status é a do dia) e escreve a observação. */
function Page() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState<"abertas" | "concluidas" | "todas">("abertas");
  const list = useScRequests("buyer", (q) => q.eq("stage", "compras"));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const done = (r: ScRow) => SC_DONE_STATUSES.includes(r.status);
  const scoped = (list.data ?? []).filter((r) => scope === "todas" || (scope === "concluidas" ? done(r) : !done(r)));
  // Etapa escolhida no bloco "Onde a SC está parada" (faixa do topo): filtra a lista; clicar de novo limpa.
  const [flow, setFlow] = useState<FlowStage | null>(null);
  const pickFlow = (s: FlowStage | null) => { setFlow(s); if (s === "comprada" && scope === "abertas") setScope("todas"); };
  const rows = scoped.filter((r) => (status === "all" || r.status === status) && (!flow || flowStage(r) === flow));
  const [edit, setEdit] = useState<ScRow | null>(null);
  const [form, setForm] = useState({ status: "", notes: "", date: "" });
  const [returning, setReturning] = useState<ScRow | null>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<"validador" | "solicitante">("validador");
  const giveBack = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_return", { _id: returning!.id, _notes: reason, _target: target });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(target === "validador" ? "Devolvida ao validador" : "Devolvida ao solicitante"); setReturning(null); setReason(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Cancelar a SC inteira (com motivo).
  const [cancelling, setCancelling] = useState<ScRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const cancelSc = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_buyer_cancel" as never, { _id: cancelling!.id, _notes: cancelReason } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("SC cancelada"); setCancelling(null); setCancelReason(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_set_status", { _id: edit!.id, _status: form.status, _notes: form.notes, ...(form.date ? { _date: form.date } : {}) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status atualizado"); setEdit(null); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Comprador" description="Solicitações validadas (e as do TOTVS). Em aberto ficam até a compra efetivada, almoxarifado, cancelada ou recusada. Clique no número para tratar os itens e anexar o pedido de compras." />
      <Tabs pageTabs defaultValue="solicitacoes">
        <TabsList>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="aprovadores">Validadores</TabsTrigger>
        </TabsList>
        <TabsContent value="solicitacoes" className="mt-4 space-y-4">
          <PurchaseInsights id="comprador" rows={list.data ?? []} loading={list.isLoading} stage={flow} onStage={pickFlow} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="block text-xs">Mostrar</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abertas">Em aberto ({(list.data ?? []).filter((r) => !done(r)).length})</SelectItem>
                  <SelectItem value="concluidas">Compradas/encerradas ({(list.data ?? []).filter(done).length})</SelectItem>
                  <SelectItem value="todas">Todas ({(list.data ?? []).length})</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <StatusFilter value={status} onChange={setStatus} counts={statusCounts(scoped)} exclude={["EM PREPARAÇÃO"]} />
            {flow && <Button variant="outline" size="sm" onClick={() => setFlow(null)}>Etapa: {FLOW_LABEL[flow]} ✕</Button>}
            <div className="ml-auto"><ScReportButton /></div>
          </div>
          {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
            <ScTable rows={rows} clientName={clientName} actions={(r) => (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEdit(r); setForm({ status: r.status, notes: r.buyer_notes ?? "", date: r.status_at }); }}><Pencil className="h-3.5 w-3.5" /> Status</Button>
                <Button size="sm" variant="ghost" title="Devolver ao validador ou ao solicitante" onClick={() => { setReturning(r); setReason(""); setTarget("validador"); }}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
                {r.stage === "compras" && <Button size="sm" variant="ghost" className="text-destructive" title="Cancelar a SC inteira" onClick={() => { setCancelling(r); setCancelReason(""); }}><Ban className="h-3.5 w-3.5" /> Cancelar</Button>}
              </div>
            )} />
          )}
        </TabsContent>
        <TabsContent value="aprovadores" className="mt-4"><ApproversPanel /></TabsContent>
      </Tabs>
      <Dialog open={!!returning} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver a SC</DialogTitle>
            <DialogDescription>{returning?.number}. Para quem ela volta?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Devolver para">
            {([["validador", "Validador", "Volta para a Validação: o validador revisa e valida de novo."], ["solicitante", "Solicitante", "Volta para rascunho: o solicitante edita e envia de novo."]] as const).map(([v, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={target === v} onClick={() => setTarget(v)}
                className={`rounded-md border p-3 text-left text-sm ${target === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                <div className="font-medium">{l}</div>
                <div className="text-xs text-muted-foreground">{d}</div>
              </button>
            ))}
          </div>
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
      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar a SC inteira</DialogTitle>
            <DialogDescription>{cancelling?.number}. A SC fica CANCELADA e sai das pendências; o motivo vai para as observações do comprador.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="cancel-notes">Motivo do cancelamento</Label>
            <Textarea id="cancel-notes" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>Voltar</Button>
            <Button variant="destructive" disabled={cancelSc.isPending || !cancelReason.trim()} onClick={() => cancelSc.mutate()}>Cancelar SC</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Status da solicitação</DialogTitle>
            <DialogDescription>{edit?.number}. Ao mudar o status a data vira a de hoje; ajuste se a compra foi finalizada em outro dia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v, date: v !== edit?.status ? todayISO() : edit?.status_at ?? f.date }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">{SC_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}><Pill className={statusClass(s.value)}>{s.value}</Pill></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="buyer-date">Data do status (ex.: dia em que a compra foi finalizada)</Label>
              <Input id="buyer-date" type="date" className="w-48" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
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

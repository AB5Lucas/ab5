import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Eye, Paperclip, Pencil, Undo2 } from "lucide-react";
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
import { ReturnScDialog } from "@/components/compras/return-dialog";
import { ScReportButton } from "@/components/compras/sc-report-dialog";
import { Pill, ScTable, todayISO, StatusFilter, statusCounts, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";
import { SC_DONE_STATUSES, SC_STATUSES, statusClass } from "@/lib/purchase-requests";
import { QuotesAttachDialog } from "@/components/compras/quotes";
import { recCols, useRecTotals } from "@/components/compras/rec-list";

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
  const rows = scoped.filter((r) => status === "all" || r.status === status);
  const [edit, setEdit] = useState<ScRow | null>(null);
  const [form, setForm] = useState({ status: "", notes: "", date: "" });
  const [returning, setReturning] = useState<ScRow | null>(null);
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
  // Recomendação: clipe das cotações em cada SC; a subaba lista as SCs com cotação (ou já enviadas à aprovação).
  const [tab, setTab] = useState(() => (typeof location !== "undefined" && ["recomendacao", "aprovadores"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "solicitacoes"));
  const changeTab = (v: string) => { setTab(v); try { history.replaceState(history.state, "", `${location.pathname}${location.search}#${v}`); } catch { /* ignora */ } };
  const [attachRow, setAttachRow] = useState<ScRow | null>(null);
  const navigate = useNavigate();
  const openRec = (id: string) => void navigate({ to: "/compras/solicitacoes/$id", params: { id }, search: { tab: "recomendacao" } });
  const openRows = useMemo(() => (list.data ?? []).filter((r) => !done(r) || r.fa_state), [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useRecTotals(openRows);
  const recRows = openRows.filter((r) => r.fa_state || (totals.get(r.id)?.quotes ?? 0) > 0);
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
      <Tabs pageTabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="recomendacao">Recomendação</TabsTrigger>
          <TabsTrigger value="aprovadores">Solicitantes</TabsTrigger>
        </TabsList>
        <TabsContent value="solicitacoes" className="mt-4 space-y-4">
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
            <div className="ml-auto"><ScReportButton /></div>
          </div>
          {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
            <ScTable rows={rows} clientName={clientName} actions={(r) => (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEdit(r); setForm({ status: r.status, notes: r.buyer_notes ?? "", date: r.status_at }); }}><Pencil className="h-3.5 w-3.5" /> Status</Button>
                <Button size="sm" variant="ghost" title="Devolver ao validador ou ao solicitante" onClick={() => setReturning(r)}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
                {r.stage === "compras" && <Button size="sm" variant="ghost" className="text-destructive" title="Cancelar a SC inteira" onClick={() => { setCancelling(r); setCancelReason(""); }}><Ban className="h-3.5 w-3.5" /> Cancelar</Button>}
              </div>
            )} endActions={(r) => {
              const n = totals.get(r.id)?.quotes ?? 0;
              return (
                <Button size="icon" variant="ghost" className="relative h-7 w-7" title={n ? `${n} cotação(ões) · anexar mais` : "Anexar cotações"} onClick={() => setAttachRow(r)}>
                  <Paperclip className={`h-4 w-4 ${n ? "text-primary" : "text-muted-foreground"}`} />
                  {n > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] leading-tight text-primary-foreground">{n}</span>}
                </Button>
              );
            }} />
          )}
        </TabsContent>
        <TabsContent value="recomendacao" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">SCs com cotações anexadas. Abra para ver a melhor escolha de cada item (aba Recomendação de compras dentro da SC) e enviar ao aprovador.</p>
          <ScTable rows={recRows} clientName={clientName} extraCols={recCols(totals)} actions={(r) => (
            <Button size="sm" variant="outline" onClick={() => openRec(r.id)}><Eye className="h-3.5 w-3.5" /> Abrir</Button>
          )} endActions={(r) => (
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Cotações" onClick={() => setAttachRow(r)}><Paperclip className="h-4 w-4 text-primary" /></Button>
          )} />
        </TabsContent>
        <TabsContent value="aprovadores" className="mt-4"><ApproversPanel /></TabsContent>
      </Tabs>
      <QuotesAttachDialog row={attachRow} onClose={() => setAttachRow(null)} onDone={(id) => openRec(id)} />
      <ReturnScDialog sc={returning} onClose={() => setReturning(null)} />
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

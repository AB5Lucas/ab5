import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScTable, useClientsList, useScRequests, type ScRow } from "@/components/compras/sc-shared";
import { PurchaseInsights, flowStage } from "@/components/insights/purchase-insights";
import { FLOW_LABEL, type FlowStage } from "@/lib/insights/purchases";

export const Route = createFileRoute("/_authenticated/compras/aprovacao")({
  head: () => ({ meta: [{ title: "Validação de Compras | AB5 Hub" }, { name: "description", content: "Solicitações de compra para eu validar e as que já validei." }] }),
  component: Page,
});

type View = "pendentes" | "aprovadas" | "devolvidas" | "todas";

/**
 * Validador = gestor do cliente da SC (ou o substituto enquanto ele está de férias; a RLS só mostra o que é dele).
 * Pendentes para validar/devolver; validadas e devolvidas por ele para consulta.
 */
function Page() {
  const { user, role } = useCurrentUser();
  // Diretoria / administração do sistema (perfil administrador): veem todas as SCs em validação e podem validar/devolver.
  const seesAll = role === "admin";
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const [view, setView] = useState<View>("pendentes");
  const [client, setClient] = useState("all");
  const list = useScRequests(`approval-${uid}`, (q) => q.or(`stage.eq.aprovacao,decided_by.eq.${uid || "00000000-0000-0000-0000-000000000000"}`));
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const all = list.data ?? [];
  const pending = all.filter((r) => r.stage === "aprovacao" && (seesAll || r.approver_id === uid || r.substitute_id === uid));
  const approved = all.filter((r) => r.decided_by === uid && r.stage !== "rascunho");
  const returned = all.filter((r) => r.decided_by === uid && r.stage === "rascunho");
  const base = view === "pendentes" ? pending : view === "aprovadas" ? approved : view === "devolvidas" ? returned : [...new Map([...pending, ...approved, ...returned].map((r) => [r.id, r])).values()];
  const seen = [...new Map([...pending, ...approved, ...returned].map((r) => [r.id, r])).values()];
  // Etapa escolhida no bloco "Onde a SC está parada" (faixa do topo): filtra a lista; clicar de novo limpa.
  const [flow, setFlow] = useState<FlowStage | null>(null);
  const pickFlow = (s: FlowStage | null) => { setFlow(s); if (s && s !== "validacao") setView("todas"); };
  const rows = base.filter((r) => (client === "all" || r.client_id === client) && (!flow || flowStage(r) === flow))
    .sort((a, b) => (view === "pendentes" ? (a.due_date ?? "").localeCompare(b.due_date ?? "") : (b.sent_at ?? "").localeCompare(a.sent_at ?? "")));
  const usedClients = [...new Set([...pending, ...approved, ...returned].map((r) => r.client_id).filter((x): x is string => !!x))];

  const [deciding, setDeciding] = useState<{ row: ScRow; approve: boolean } | null>(null);
  const [notes, setNotes] = useState("");
  const decide = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_decide", { _id: deciding!.row.id, _approve: deciding!.approve, _notes: notes });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(deciding?.approve ? "Validada e enviada para o Comprador" : "Devolvida ao solicitante"); setDeciding(null); setNotes(""); qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["nav-badges"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Validação" description="Solicitações dos clientes em que você é o gestor (ou substituto durante as férias dele). Clique no número para ver os itens." />
      <PurchaseInsights id="validacao" rows={seen} loading={list.isLoading} stage={flow} onStage={pickFlow} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Situação</Label>
          <Select value={view} onValueChange={(v) => setView(v as View)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">{seesAll ? "Em validação (todas)" : "Para validar"} ({pending.length})</SelectItem>
              <SelectItem value="aprovadas">Validadas por mim ({approved.length})</SelectItem>
              <SelectItem value="devolvidas">Devolvidas por mim ({returned.length})</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cliente</Label>
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Todos</SelectItem>
              {usedClients.map((id) => <SelectItem key={id} value={id}>{clientName.get(id) ?? "—"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {flow && <Button variant="outline" size="sm" onClick={() => setFlow(null)}>Etapa: {FLOW_LABEL[flow]} ✕</Button>}
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={rows} clientName={clientName} actions={(r) => r.stage === "aprovacao" && (r.approver_id === uid || r.substitute_id === uid) ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}><Check className="h-3.5 w-3.5" /> Validar</Button>
            <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, approve: false })}><Undo2 className="h-3.5 w-3.5" /> Devolver</Button>
          </div>
        ) : null} />
      )}
      <Dialog open={!!deciding} onOpenChange={(o) => { if (!o) { setDeciding(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.approve ? "Validar solicitação" : "Devolver ao solicitante"}</DialogTitle>
            <DialogDescription>{deciding?.row.number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="appr-notes">{deciding?.approve ? "Observação (opcional)" : "Motivo da devolução"}</Label>
            <Textarea id="appr-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancelar</Button>
            <Button disabled={decide.isPending} onClick={() => decide.mutate()}>{deciding?.approve ? "Validar" : "Devolver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

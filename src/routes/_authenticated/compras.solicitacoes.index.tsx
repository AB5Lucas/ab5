import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Copy, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SC_DONE_STATUSES } from "@/lib/purchase-requests";
import { ScHeaderDialog, ScRemoveDialog, ScTable, StatusFilter, statusCounts, useClientsList, useScRemove, useScRequests, type ScRow } from "@/components/compras/sc-shared";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/")({
  head: () => ({ meta: [{ title: "Solicitações de Compra | AB5 Hub" }, { name: "description", content: "Minhas solicitações de compra, status e envio para aprovação." }] }),
  component: Page,
});

/** Visão do solicitante: as SCs dele e as que tem em cópia (observador), filtro de status, Enviar, Apagar (não enviada) e Cancelar (enviada). */
type Scope = "todas" | "minhas" | "copia";
function Page() {
  const { user, isAdmin: admin } = useCurrentUser();
  const { canAccess } = useAccess();
  // Administrador e comprador veem todas as SCs (a RLS libera).
  const isAdmin = admin || canAccess("/compras/comprador");
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState<Scope>("todas");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ScRow | null>(null);
  const uid = user?.id ?? "00000000-0000-0000-0000-000000000000";
  const list = useScRequests(`mine-${uid}-${isAdmin}`, (q) => (isAdmin ? q : q.or(`requester_id.eq.${uid},observer_ids.cs.{${uid}}`)));
  const [show, setShow] = useState<"abertas" | "concluidas" | "todas">("abertas");
  const done = (r: ScRow) => SC_DONE_STATUSES.includes(r.status);
  const all = list.data ?? [];
  const shownAll = all.filter((r) => show === "todas" || (show === "concluidas" ? done(r) : !done(r)));
  const mine = shownAll.filter((r) => r.requester_id === uid);
  const copied = shownAll.filter((r) => r.requester_id !== uid && (r.observer_ids ?? []).includes(uid));
  const scoped = scope === "minhas" ? mine : scope === "copia" ? copied : shownAll;
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const rows = scoped.filter((r) => status === "all" || r.status === status);
  const send = useMutation({
    mutationFn: async (id: string) => { const { data, error } = await supabase.rpc("purchase_request_send", { _id: id }); if (error) throw error; return data; },
    onSuccess: (to) => { toast.success(to === "compras" ? "Enviada direto para o Comprador" : "Enviada para o validador"); qc.invalidateQueries({ queryKey: ["sc-requests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useScRemove(() => setRemoving(null));
  const navigate = useNavigate();
  const [editing, setEditing] = useState<ScRow | null>(null);
  // Lápis: rascunho abre o cabeçalho; em validação, puxa de volta antes (bloqueado se o validador estiver com ela aberta).
  const edit = useMutation({
    mutationFn: async (r: ScRow) => {
      if (r.stage === "aprovacao") {
        const { error } = await supabase.rpc("purchase_request_recall", { _id: r.id });
        if (error) throw error;
        const { data } = await supabase.from("purchase_requests").select("*").eq("id", r.id).maybeSingle();
        return (data as ScRow | null) ?? r;
      }
      return r;
    },
    // Lápis abre a própria SC já em edição (cabeçalho e itens).
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["menu-badges"] }); navigate({ to: "/compras/solicitacoes/$id", params: { id: r.id }, search: { edit: true } }); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Copiar: SC nova (rascunho, número novo, minha) com o mesmo cabeçalho e itens; status, pedidos e datas ficam de fora.
  const copy = useMutation({
    mutationFn: async (r: ScRow) => {
      const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const payload = {
        category: r.category, nature: r.nature, priority: r.priority, client_id: r.client_id ?? "",
        due_date: r.due_date && r.due_date >= today ? r.due_date : null, delivery_kind: r.delivery_kind, delivery_place: r.delivery_place ?? "",
        notes: r.notes ?? "", justification: r.justification || "Cópia de " + r.number, observer_ids: r.observer_ids ?? [],
      };
      const { data: newId, error } = await supabase.rpc("purchase_request_create", { _p: payload as never });
      if (error) throw error;
      const { data: items, error: ie } = await supabase.from("purchase_request_items").select("*").eq("request_id", r.id).order("item_no");
      if (ie) throw ie;
      if (items?.length) {
        const { error: ce } = await supabase.from("purchase_request_items").insert(items.map((i) => ({
          request_id: newId as string, item_no: i.item_no, quantity: i.quantity, unit: i.unit, description: i.description, budget: i.budget,
          notes: i.notes, work_id: i.work_id, cc_code: i.cc_code, photo_path: i.photo_path, quote_path: i.quote_path,
        })));
        if (ce) throw ce;
      }
      if (r.total_budget != null) await supabase.from("purchase_requests").update({ total_budget: r.total_budget }).eq("id", newId as string);
      return newId as string;
    },
    onSuccess: (id) => {
      toast.success("Cópia criada. Confira a data prazo e envie.");
      qc.invalidateQueries({ queryKey: ["sc-requests"] });
      navigate({ to: "/compras/solicitacoes/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copyBtn = (r: ScRow) => (
    <Button size="icon" variant="ghost" className="h-8 w-8" title="Copiar para uma SC nova" aria-label="Copiar solicitação" disabled={copy.isPending} onClick={() => copy.mutate(r)}><Copy className="h-4 w-4" /></Button>
  );
  const editBtn = (r: ScRow) => (
    <Button size="icon" variant="ghost" className="h-8 w-8" title={r.stage === "aprovacao" ? "Puxar de volta e editar (antes da validação)" : "Editar"} aria-label="Editar solicitação" disabled={edit.isPending} onClick={() => edit.mutate(r)}><Pencil className="h-4 w-4" /></Button>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Suas solicitações e as que você acompanha em cópia. Enviar manda para o validador (gestor do cliente); depois de validada, vai para o Comprador. Antes da validação você pode puxar de volta pelo lápis (fica bloqueado enquanto o validador está com ela aberta); depois, só se o validador ou o Comprador devolver. O botão de copiar cria uma SC nova igual." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="block text-xs">Mostrar</Label>
          <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertas">Em aberto ({all.filter((r) => !done(r)).length})</SelectItem>
              <SelectItem value="concluidas">Compradas/encerradas ({all.filter(done).length})</SelectItem>
              <SelectItem value="todas">Todas ({all.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="block text-xs">Acompanhar</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{isAdmin ? "Todas do sistema" : "Todas"} ({shownAll.length})</SelectItem>
              <SelectItem value="minhas">Feitas por mim ({mine.length})</SelectItem>
              <SelectItem value="copia">Em cópia (observador) ({copied.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <StatusFilter value={status} onChange={setStatus} counts={statusCounts(scoped)} />
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova</Button>
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <ScTable rows={rows} clientName={clientName} showRequester={scope !== "minhas"} actions={(r) => r.requester_id !== uid ? <div className="flex">{copyBtn(r)}</div> : r.stage === "rascunho" ? (
          <div className="flex gap-1">
            <Button size="sm" disabled={send.isPending} onClick={() => send.mutate(r.id)}><Send className="h-3.5 w-3.5" /> Enviar</Button>
            {editBtn(r)}
            {copyBtn(r)}
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Apagar" aria-label="Apagar solicitação" onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ) : (
          <div className="flex gap-1">
            {r.stage === "aprovacao" && editBtn(r)}
            {copyBtn(r)}
            {(r.stage === "aprovacao" || r.stage === "compras") && <Button size="sm" variant="outline" onClick={() => setRemoving(r)}><Ban className="h-3.5 w-3.5" /> Cancelar</Button>}
          </div>
        )} />
      )}
      <ScHeaderDialog open={creating} onOpenChange={setCreating} />
      <ScHeaderDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} editing={editing} />
      <ScRemoveDialog row={removing} onClose={() => setRemoving(null)} pending={remove.isPending} onConfirm={(r) => remove.mutate(r)} />
    </div>
  );
}

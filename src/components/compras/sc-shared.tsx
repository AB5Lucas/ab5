import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  SC_CATEGORIES, SC_NATURES, SC_PRIORITIES, SC_STATUSES, SC_SYSTEMS, STAGE_LABEL, brDate, deadlineControl, deliveryLabel,
  priorityClass, statusClass, type ScStage,
} from "@/lib/purchase-requests";
import type { Tables } from "@/integrations/supabase/types";

export type ScRow = Tables<"purchase_requests">;
export const todayISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export function useClientsList() {
  return useQuery({
    queryKey: ["sc-clients"],
    staleTime: 10 * 60_000,
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
}

/** SCs visíveis ao usuário (a RLS decide: as próprias, as que ele aprova, as de Compras para o comprador). */
export function useScRequests(key: string, filter: (q: any) => any) {
  return useQuery({
    queryKey: ["sc-requests", key],
    queryFn: () => fetchAll<ScRow>((a, b) => filter(supabase.from("purchase_requests").select("*")).order("created_at", { ascending: false }).range(a, b)),
  });
}

export function Pill({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium", className)}>{children}</span>;
}

/** Filtro de status como a coluna AA da planilha (com "Todos"). */
export function StatusFilter({ value, onChange, counts }: { value: string; onChange: (v: string) => void; counts: Map<string, number> }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Status</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="all">Todos ({[...counts.values()].reduce((s, n) => s + n, 0)})</SelectItem>
          {SC_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.value} ({counts.get(s.value) ?? 0})</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Tabela de controle (mesmas colunas da aba CONTROLE DE SC que o sistema usa). */
export function ScTable({ rows, clientName, actions, showRequester = true }: {
  rows: ScRow[]; clientName: Map<string, string>; actions?: (r: ScRow) => ReactNode; showRequester?: boolean;
}) {
  const today = todayISO();
  return (
    <div className="panel overflow-x-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Nº da solicitação</TableHead>
            <TableHead>Data</TableHead>
            {showRequester && <TableHead>Solicitante</TableHead>}
            <TableHead>Tipo</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Natureza</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Prazo</TableHead>
            <TableHead>Local de entrega</TableHead>
            <TableHead>Envio</TableHead>
            <TableHead>Controle de prazo</TableHead>
            <TableHead>Etapa</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Obs. comprador</TableHead>
            {actions && <TableHead className="text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows.length ? (
            <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground">Nenhuma solicitação.</TableCell></TableRow>
          ) : rows.map((r) => {
            const dl = deadlineControl(r, today);
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link to="/compras/solicitacoes/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.number}</Link>
                </TableCell>
                <TableCell>{brDate(r.request_date)}</TableCell>
                {showRequester && <TableCell className="whitespace-nowrap">{r.requester_name}</TableCell>}
                <TableCell>{r.system}</TableCell>
                <TableCell>{r.category}</TableCell>
                <TableCell>{r.nature}</TableCell>
                <TableCell><Pill className={priorityClass(r.priority)}>{r.priority}</Pill></TableCell>
                <TableCell>{r.client_id ? clientName.get(r.client_id) ?? "—" : "—"}</TableCell>
                <TableCell>{brDate(r.due_date)}</TableCell>
                <TableCell>{deliveryLabel(r, r.client_id ? clientName.get(r.client_id) : null)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.sent_at ? brDate(r.sent_at.slice(0, 10)) : <span className="text-muted-foreground">não enviado</span>}</TableCell>
                <TableCell><Pill className={dl.cls}>{dl.label}</Pill></TableCell>
                <TableCell className="whitespace-nowrap" title={r.approver_notes ?? undefined}>
                  {STAGE_LABEL[r.stage as ScStage] ?? r.stage}
                  {r.stage === "rascunho" && r.approver_notes && <div className="text-[11px] text-destructive">devolvida: {r.approver_notes}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Pill className={statusClass(r.status)}>{r.status}</Pill>
                  <div className="text-[11px] text-muted-foreground">{brDate(r.status_at)}</div>
                </TableCell>
                <TableCell className="max-w-48 truncate" title={r.buyer_notes ?? undefined}>{r.buyer_notes ?? "—"}</TableCell>
                {actions && <TableCell className="text-right">{actions(r)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export const statusCounts = (rows: ScRow[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
  return m;
};

type HeaderForm = {
  system: string; category: string; nature: string; priority: string; client_id: string; due_date: string;
  delivery_kind: "ab5" | "cliente" | "outro"; delivery_place: string; notes: string;
};
const EMPTY: HeaderForm = { system: "PLANILHA", category: "", nature: "", priority: "", client_id: "", due_date: "", delivery_kind: "ab5", delivery_place: "", notes: "" };

/**
 * Formulário de controle (cabeçalho da SC). Novo: cria pela função purchase_request_create (número
 * SC-NOME-001 e solicitante automáticos) e abre a página da solicitação; edição: só enquanto está com o solicitante.
 */
export function ScHeaderDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: ScRow | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const clients = useClientsList();
  const [f, setF] = useState<HeaderForm>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? editing?.id ?? "new" : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (open) setF(editing ? {
      system: editing.system, category: editing.category, nature: editing.nature, priority: editing.priority, client_id: editing.client_id ?? "",
      due_date: editing.due_date, delivery_kind: editing.delivery_kind as HeaderForm["delivery_kind"], delivery_place: editing.delivery_place ?? "", notes: editing.notes ?? "",
    } : EMPTY);
  }
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const save = useMutation({
    mutationFn: async () => {
      const miss = [!f.category && "categoria", !f.nature && "natureza", !f.priority && "prioridade", !f.client_id && "cliente", !f.due_date && "data prazo",
        f.delivery_kind === "outro" && !f.delivery_place.trim() && "local de entrega"].filter(Boolean);
      if (miss.length) throw new Error(`Preencha: ${miss.join(", ")}.`);
      if (f.due_date < todayISO()) throw new Error("A data prazo não pode ser antes de hoje.");
      const payload = { ...f, delivery_place: f.delivery_kind === "outro" ? f.delivery_place.trim() : "" };
      if (editing) {
        const { error } = await supabase.from("purchase_requests").update({
          system: payload.system, category: payload.category, nature: payload.nature, priority: payload.priority, client_id: payload.client_id,
          due_date: payload.due_date, delivery_kind: payload.delivery_kind, delivery_place: payload.delivery_place || null, notes: payload.notes.trim() || null,
        }).eq("id", editing.id);
        if (error) throw error;
        return editing.id;
      }
      const { data, error } = await supabase.rpc("purchase_request_create", { _p: payload as never });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["sc-requests"] });
      qc.invalidateQueries({ queryKey: ["sc-request", id] });
      onOpenChange(false);
      if (!editing) { toast.success("Solicitação criada. Agora inclua os itens."); navigate({ to: "/compras/solicitacoes/$id", params: { id } }); }
      else toast.success("Solicitação atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof HeaderForm>(k: K, v: HeaderForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const sel = (label: string, k: keyof HeaderForm, options: readonly string[], render?: (v: string) => ReactNode) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={f[k] as string} onValueChange={(v) => set(k, v as never)}>
        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent className="max-h-72">{options.map((o) => <SelectItem key={o} value={o}>{render ? render(o) : o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.number}` : "Nova solicitação de compra"}</DialogTitle>
          <DialogDescription>
            {editing ? "Controle da solicitação." : "Data, solicitante e número (SC-NOME-001) são preenchidos sozinhos. Depois de salvar, você inclui os itens."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {sel("Planilha ou TOTVS", "system", SC_SYSTEMS)}
          {sel("Categoria", "category", SC_CATEGORIES)}
          {sel("Natureza da compra", "nature", SC_NATURES)}
          {sel("Prioridade", "priority", SC_PRIORITIES.map((p) => p.value), (v) => <Pill className={priorityClass(v)}>{v}</Pill>)}
          <div className="space-y-1">
            <Label>Cliente</Label>
            <Select value={f.client_id} onValueChange={(v) => set("client_id", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
              <SelectContent className="max-h-72">{(clients.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-due">Data prazo dos itens</Label>
            <Input id="sc-due" type="date" min={todayISO()} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Local de entrega</Label>
            <Select value={f.delivery_kind} onValueChange={(v) => set("delivery_kind", v as HeaderForm["delivery_kind"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ab5">AB5</SelectItem>
                <SelectItem value="cliente">{f.client_id ? clientName.get(f.client_id) ?? "Cliente" : "Cliente (o escolhido acima)"}</SelectItem>
                <SelectItem value="outro">Outro (escrever)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.delivery_kind === "outro" && (
            <div className="space-y-1">
              <Label htmlFor="sc-place">Endereço / local</Label>
              <Input id="sc-place" value={f.delivery_place} onChange={(e) => set("delivery_place", e.target.value)} />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="sc-notes">Observações</Label>
            <Textarea id="sc-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{editing ? "Salvar" : "Criar e incluir itens"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

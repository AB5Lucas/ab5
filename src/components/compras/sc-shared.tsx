import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchSelect } from "@/components/search-select";
import { Camera, Lock, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  FIXED_OBSERVERS, SC_CATEGORIES, SC_NATURES, SC_PRIORITIES, SC_STATUSES, SC_SYSTEMS, STAGE_LABEL, brDate, deadlineControl, deliveryLabel,
  priorityClass, statusClass, statusDot, type ScStage,
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
                  <span className={cn("mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle", statusDot(r.status))} title={r.status} aria-label={`Status: ${r.status}`} />
                  <Link to="/compras/solicitacoes/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.number}</Link>
                </TableCell>
                <TableCell>{brDate(r.request_date)}</TableCell>
                {showRequester && <TableCell className="whitespace-nowrap">{r.requester_name}</TableCell>}
                <TableCell>{r.system}</TableCell>
                <TableCell>{r.category ?? "—"}</TableCell>
                <TableCell>{r.nature ?? "—"}</TableCell>
                <TableCell>{r.priority ? <Pill className={priorityClass(r.priority)}>{r.priority}</Pill> : "—"}</TableCell>
                <TableCell>{r.client_id ? clientName.get(r.client_id) ?? "—" : "—"}</TableCell>
                <TableCell>{brDate(r.due_date)}</TableCell>
                <TableCell>{deliveryLabel(r, r.client_id ? clientName.get(r.client_id) : null)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.sent_at ? brDate(r.sent_at.slice(0, 10)) : <span className="text-muted-foreground">não enviado</span>}</TableCell>
                <TableCell><Pill className={dl.cls}>{dl.label}</Pill></TableCell>
                <TableCell className="whitespace-nowrap" title={r.return_notes ?? r.approver_notes ?? undefined}>
                  {STAGE_LABEL[r.stage as ScStage] ?? r.stage}
                  {r.stage === "rascunho" && r.return_notes && <div className="max-w-56 truncate text-[11px] text-destructive">devolvida · {r.return_notes}</div>}
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
  delivery_kind: "ab5" | "cliente" | "outro" | "retirar"; delivery_place: string; notes: string; observer_ids: string[];
};
const EMPTY: HeaderForm = {
  system: "PLANILHA", category: "", nature: "", priority: "", client_id: "", due_date: "", delivery_kind: "ab5", delivery_place: "", notes: "",
  observer_ids: FIXED_OBSERVERS,
};

/** Usuários ativos (observadores em cópia). */
export function useScUsers() {
  return useQuery({
    queryKey: ["sc-users"],
    staleTime: 10 * 60_000,
    queryFn: async () => (await supabase.from("users_profiles").select("id, full_name, email, active").order("full_name")).data ?? [],
  });
}

/** Observadores em cópia: Marcelo Barrella e Vitória Brasilino ficam sempre (cadeado; nunca o próprio solicitante); os demais se incluem e tiram. */
export function ObserversField({ value, onChange, requesterId }: { value: string[]; onChange: (v: string[]) => void; requesterId?: string | null | undefined }) {
  const users = useScUsers();
  const { user } = useCurrentUser();
  requesterId = requesterId ?? user?.id;
  const name = new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email || "—"]));
  const list = [...new Set([...FIXED_OBSERVERS, ...value])].filter((id) => id !== requesterId);
  const options = (users.data ?? []).filter((u) => u.active !== false && !list.includes(u.id) && u.id !== requesterId)
    .map((u) => ({ value: u.id, label: u.full_name || u.email || "—", hint: u.full_name ? u.email ?? undefined : undefined }));
  return (
    <div className="space-y-1">
      <Label className="block">Observadores em cópia</Label>
      <div className="flex flex-wrap gap-1.5">
        {list.map((id) => {
          const fixed = FIXED_OBSERVERS.includes(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
              {name.get(id) ?? "…"}
              {fixed
                ? <Lock className="h-3 w-3 text-muted-foreground" aria-label="Fixo" />
                : <button type="button" aria-label={`Tirar ${name.get(id) ?? ""}`} onClick={() => onChange(value.filter((x) => x !== id))}><X className="h-3 w-3" /></button>}
            </span>
          );
        })}
      </div>
      <SearchSelect value="" onChange={(v) => onChange([...new Set([...value, v])])} options={options} placeholder="+ Incluir observador" searchPlaceholder="Digite o nome" className="h-8 sm:w-72" />
      <p className="text-xs text-muted-foreground">Os observadores recebem a SC só para acompanhar.</p>
    </div>
  );
}

/**
 * Formulário de controle (cabeçalho da SC). Novo: cria pela função purchase_request_create (número
 * SC-NOME-001 e solicitante automáticos) e abre a página da solicitação; edição: só enquanto está com o solicitante.
 * TOTVS: só o número da SC do TOTVS e a foto; Enviar manda direto para o Comprador.
 */
export function ScHeaderDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: ScRow | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const clients = useClientsList();
  const [f, setF] = useState<HeaderForm>(EMPTY);
  const [totvs, setTotvs] = useState<{ number: string; file: File | null }>({ number: "", file: null });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? editing?.id ?? "new" : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (open) {
      setTotvs({ number: "", file: null });
      setF(editing ? {
        system: editing.system, category: editing.category ?? "", nature: editing.nature ?? "", priority: editing.priority ?? "", client_id: editing.client_id ?? "",
        due_date: editing.due_date ?? "", delivery_kind: editing.delivery_kind as HeaderForm["delivery_kind"], delivery_place: editing.delivery_place ?? "",
        notes: editing.notes ?? "", observer_ids: editing.observer_ids ?? [],
      } : EMPTY);
    }
  }
  const isTotvs = !editing && f.system === "TOTVS";
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const save = useMutation({
    mutationFn: async () => {
      if (isTotvs) {
        if (!totvs.number.trim()) throw new Error("Informe o número da SC do TOTVS.");
        if (!totvs.file) throw new Error("Anexe a foto da SC do TOTVS.");
        const path = `totvs/${crypto.randomUUID()}-${totvs.file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("purchase-photos").upload(path, totvs.file);
        if (up.error) throw up.error;
        const { data, error } = await supabase.rpc("purchase_request_create_totvs", { _number: totvs.number, _photo: path, _observers: f.observer_ids });
        if (error) throw error;
        return data as string;
      }
      const miss = [!f.category && "categoria", !f.nature && "natureza", !f.priority && "prioridade", !f.client_id && "cliente", !f.due_date && "data prazo",
        f.delivery_kind === "outro" && !f.delivery_place.trim() && "local de entrega"].filter(Boolean);
      if (miss.length) throw new Error(`Preencha: ${miss.join(", ")}.`);
      if (f.due_date < todayISO()) throw new Error("A data prazo não pode ser antes de hoje.");
      const payload = { ...f, delivery_place: f.delivery_kind === "outro" ? f.delivery_place.trim() : "" };
      if (editing) {
        const { error } = await supabase.from("purchase_requests").update({
          category: payload.category, nature: payload.nature, priority: payload.priority, client_id: payload.client_id,
          due_date: payload.due_date, delivery_kind: payload.delivery_kind, delivery_place: payload.delivery_place || null, notes: payload.notes.trim() || null,
          observer_ids: payload.observer_ids,
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
      if (isTotvs) toast.success("SC do TOTVS enviada para o Comprador");
      else if (!editing) { toast.success("Solicitação criada. Agora inclua os itens."); navigate({ to: "/compras/solicitacoes/$id", params: { id } }); }
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
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", isTotvs ? "max-w-md" : "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.number}` : isTotvs ? "SC do TOTVS" : "Nova solicitação de compra"}</DialogTitle>
          <DialogDescription>
            {editing ? "Controle da solicitação." : isTotvs ? "Informe o número da SC aberta no TOTVS e a foto. Ela vai direto para o Comprador."
              : "Data, solicitante e número (SC-NOME-001) são preenchidos sozinhos. Depois de salvar, você inclui os itens."}
          </DialogDescription>
        </DialogHeader>
        {!editing && sel("Planilha ou TOTVS", "system", SC_SYSTEMS)}
        {isTotvs ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sc-totvs">Nº da SC no TOTVS</Label>
              <Input id="sc-totvs" value={totvs.number} onChange={(e) => setTotvs((t) => ({ ...t, number: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="block">Foto</Label>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent">
                <Camera className="h-4 w-4" /> {totvs.file ? totvs.file.name : "Escolher foto"}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0] ?? null; setTotvs((t) => ({ ...t, file })); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sel("Categoria", "category", SC_CATEGORIES)}
            {sel("Natureza da compra", "nature", SC_NATURES)}
            {sel("Prioridade", "priority", SC_PRIORITIES.map((p) => p.value), (v) => <Pill className={priorityClass(v)}>{v}</Pill>)}
            <div className="space-y-1">
              <Label>Cliente</Label>
              <SearchSelect value={f.client_id} onChange={(v) => set("client_id", v)} placeholder="Selecione o cliente" searchPlaceholder="Digite o cliente"
                options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
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
                  <SelectItem value="retirar">Retirar</SelectItem>
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
        )}
        <ObserversField value={f.observer_ids} onChange={(v) => set("observer_ids", v)} requesterId={editing?.requester_id} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{editing ? "Salvar" : isTotvs ? "Enviar" : "Criar e incluir itens"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Apagar (nunca enviada) ou cancelar (já enviada) uma SC do próprio solicitante. */
export function useScRemove(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: ScRow) => {
      if (r.stage === "rascunho") {
        const { error } = await supabase.from("purchase_requests").delete().eq("id", r.id);
        if (error) throw error;
        return "apagada";
      }
      const { error } = await supabase.rpc("purchase_request_cancel", { _id: r.id });
      if (error) throw error;
      return "cancelada";
    },
    onSuccess: (what) => { toast.success(`Solicitação ${what}`); qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["sc-request"] }); onDone?.(); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function ScRemoveDialog({ row, onClose, onConfirm, pending }: { row: ScRow | null; onClose: () => void; onConfirm: (r: ScRow) => void; pending: boolean }) {
  const del = row?.stage === "rascunho";
  return (
    <AlertDialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{del ? "Apagar esta solicitação?" : "Cancelar esta solicitação?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {row?.number}. {del ? "Ela ainda não foi enviada e será apagada com os itens." : "Ela já foi enviada: fica no histórico com o status CANCELADA e sai do autorizante e do Comprador."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); if (row) onConfirm(row); }}>{del ? "Apagar" : "Cancelar SC"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

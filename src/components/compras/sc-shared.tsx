import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
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
import { Lock, Send, X } from "lucide-react";
import { PastePrint } from "@/components/compras/paste-print";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { applyColumnFilters, FilterHead, rowsForColumn, type ColumnDef, type ColumnFilters, type ColumnSort } from "@/components/column-filter";
import {
  FIXED_OBSERVERS, SC_CATEGORIES, SC_NATURES, SC_PRIORITIES, SC_STATUSES, SC_SYSTEMS, STAGE_LABEL, brDate, deadlineControl, deliveryLabel,
  priorityClass, statusClass, statusDot, type ScStage,
} from "@/lib/purchase-requests";
import type { Tables } from "@/integrations/supabase/types";

export type ScRow = Tables<"purchase_requests">;
const RATEIO_KEY = "__rateio__";
/** Print da solicitação (imagem colada) é obrigatório para enviar a SC do TOTVS. */
export const PRINT_REQUIRED = "O print da solicitação é obrigatório.";
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
export function StatusFilter({ value, onChange, counts, exclude = [] }: { value: string; onChange: (v: string) => void; counts: Map<string, number>; exclude?: string[] }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Status</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="all">Todos ({[...counts.values()].reduce((s, n) => s + n, 0)})</SelectItem>
          {SC_STATUSES.filter((s) => !exclude.includes(s.value)).map((s) => <SelectItem key={s.value} value={s.value}>{s.value} ({counts.get(s.value) ?? 0})</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Tabela de controle (mesmas colunas da aba CONTROLE DE SC que o sistema usa); cada título filtra/ordena como no Excel. */
export function ScTable({ rows, clientName, actions, showRequester = true }: {
  rows: ScRow[]; clientName: Map<string, string>; actions?: (r: ScRow) => ReactNode; showRequester?: boolean;
}) {
  const today = todayISO();
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const cli = (r: ScRow) => (r.client_id ? clientName.get(r.client_id) ?? "" : "");
  type Col = ColumnDef<ScRow> & { cell: (r: ScRow, dl: ReturnType<typeof deadlineControl>) => ReactNode; className?: string };
  const cols: Col[] = [
    { key: "number", label: "Nº da solicitação", values: (r) => [r.number], sort: (r) => r.number, className: "whitespace-nowrap font-medium",
      cell: (r) => <>
        <span className={cn("mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle", statusDot(r.status))} title={r.status} aria-label={`Status: ${r.status}`} />
        <Link to="/compras/solicitacoes/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.number}</Link>
      </> },
    { key: "date", label: "Data", values: (r) => [brDate(r.request_date)], sort: (r) => r.request_date, cell: (r) => brDate(r.request_date) },
    { key: "status", label: "Status", values: (r) => [r.status], className: "whitespace-nowrap",
      cell: (r) => <Pill className={statusClass(r.status)}>{r.status}</Pill> },
    ...(showRequester ? [{ key: "requester", label: "Solicitante", values: (r: ScRow) => [r.requester_name], className: "whitespace-nowrap", cell: (r: ScRow) => r.requester_name } as Col] : []),
    { key: "system", label: "Tipo", values: (r) => [r.system], cell: (r) => r.system },
    { key: "category", label: "Categoria", values: (r) => [r.category ?? ""], cell: (r) => r.category ?? "—" },
    { key: "nature", label: "Natureza", values: (r) => [r.nature ?? ""], cell: (r) => r.nature ?? "—" },
    { key: "priority", label: "Prioridade", values: (r) => [r.priority ?? ""], cell: (r) => (r.priority ? <Pill className={priorityClass(r.priority)}>{r.priority}</Pill> : "—") },
    { key: "client", label: "Cliente", values: (r) => [cli(r)], cell: (r) => cli(r) || "—" },
    { key: "due", label: "Prazo", values: (r) => [brDate(r.due_date)], sort: (r) => r.due_date, cell: (r) => brDate(r.due_date) },
    { key: "delivery", label: "Local de entrega", values: (r) => [deliveryLabel(r, cli(r) || null)], cell: (r) => deliveryLabel(r, cli(r) || null) },
    { key: "sent", label: "Envio", values: (r) => [r.sent_at ? brDate(r.sent_at.slice(0, 10)) : "não enviado"], sort: (r) => r.sent_at, className: "whitespace-nowrap",
      cell: (r) => (r.sent_at ? brDate(r.sent_at.slice(0, 10)) : <span className="text-muted-foreground">não enviado</span>) },
    { key: "deadline", label: "Controle de prazo", values: (r) => [deadlineControl(r, today).label], cell: (_r, dl) => <Pill className={dl.cls}>{dl.label}</Pill> },
    { key: "stage", label: "Etapa", values: (r) => [STAGE_LABEL[r.stage as ScStage] ?? r.stage], className: "whitespace-nowrap",
      cell: (r) => <>
        {STAGE_LABEL[r.stage as ScStage] ?? r.stage}
        {r.return_notes && (r.stage === "rascunho" || (r.stage === "aprovacao" && r.return_notes.startsWith("Comprador (ao validador)"))) && <div className="max-w-56 truncate text-[11px] text-destructive">devolvida · {r.return_notes}</div>}
      </> },
    { key: "status_at", label: "Data do status", values: (r) => [r.status_at ? brDate(r.status_at) : ""], sort: (r) => r.status_at, className: "whitespace-nowrap",
      cell: (r) => (r.status_at ? brDate(r.status_at) : "—") },
    { key: "buyer", label: "Obs. comprador", values: (r) => [r.buyer_notes ?? ""], className: "max-w-48 truncate", cell: (r) => r.buyer_notes ?? "—" },
  ];
  const shown = applyColumnFilters(rows, cols, filters, sort);
  const filtered = Object.keys(filters).some((k) => filters[k]);
  return (
    <div className="space-y-1">
      {filtered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {shown.length} de {rows.length}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters({})}>Limpar filtros</Button>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <Fragment key={c.key}>
                  <FilterHead column={c} rows={rowsForColumn(rows, cols, filters, c.key)} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />
                  {actions && c.key === "status" && <TableHead>Ações</TableHead>}
                </Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!shown.length ? (
              <TableRow><TableCell colSpan={cols.length + 1} className="text-center text-muted-foreground">Nenhuma solicitação.</TableCell></TableRow>
            ) : shown.map((r) => {
              const dl = deadlineControl(r, today);
              return (
                <TableRow key={r.id}>
                  {cols.map((c) => (
                    <Fragment key={c.key}>
                      <TableCell className={c.className} title={c.key === "buyer" ? r.buyer_notes ?? undefined : c.key === "stage" ? r.return_notes ?? r.approver_notes ?? undefined : undefined}>{c.cell(r, dl)}</TableCell>
                      {actions && c.key === "status" && <TableCell className="whitespace-nowrap">{actions(r)}</TableCell>}
                    </Fragment>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
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
  delivery_kind: "ab5" | "cliente" | "outro" | "retirar"; delivery_place: string; justification: string; notes: string; observer_ids: string[];
};
const EMPTY: HeaderForm = {
  system: "PLANILHA", category: "", nature: "", priority: "", client_id: "", due_date: "", delivery_kind: "ab5", delivery_place: "", justification: "", notes: "",
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
 * TOTVS: o número da SC do TOTVS e o print colado (obrigatório); Enviar manda direto para o Comprador.
 */
export function ScHeaderDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: ScRow | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const clients = useClientsList();
  const [f, setF] = useState<HeaderForm>(EMPTY);
  const [totvs, setTotvs] = useState<{ number: string; file: File | null; work: string; cc: string }>({ number: "", file: null, work: RATEIO_KEY, cc: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [totvsStep, setTotvsStep] = useState(false);
  const key = open ? editing?.id ?? "new" : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (open) {
      setTotvs({ number: "", file: null, work: RATEIO_KEY, cc: "" });
      setTotvsStep(false);
      setF(editing ? {
        system: editing.system, category: editing.category ?? "", nature: editing.nature ?? "", priority: editing.priority ?? "", client_id: editing.client_id ?? "",
        due_date: editing.due_date ?? "", delivery_kind: editing.delivery_kind as HeaderForm["delivery_kind"], delivery_place: editing.delivery_place ?? "",
        justification: editing.justification ?? "", notes: editing.notes ?? "", observer_ids: editing.observer_ids ?? [],
      } : EMPTY);
    }
  }
  const isTotvs = !editing && f.system === "TOTVS";
  // Cabeçalho igual para planilha e TOTVS (no TOTVS, depois vem a tela do nº + foto).
  const checkHeader = () => {
    const miss = [!f.category && "categoria", !f.nature && "natureza", !f.priority && "prioridade", !f.client_id && "cliente", !f.due_date && "data prazo",
      f.delivery_kind === "outro" && !f.delivery_place.trim() && "local de entrega", !f.justification.trim() && "justificativa"].filter(Boolean);
    if (miss.length) throw new Error(`Preencha: ${miss.join(", ")}.`);
    if (!editing && f.due_date < todayISO()) throw new Error("A data prazo não pode ser antes de hoje.");
  };
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  // TOTVS: centro de custo (serviço do cliente ou rateio) e CC (automático = prefixo do cliente + sufixo; dá para digitar).
  const totvsDest = useRef<string>("");
  const totvsWorks = useQuery({
    queryKey: ["sc-works", f.client_id],
    enabled: isTotvs && !!f.client_id,
    queryFn: async () => (await supabase.from("works").select("id, name, cc_suffix, active, order_number").eq("client_id", f.client_id).order("name")).data ?? [],
  });
  const totvsPrefix = useQuery({
    queryKey: ["sc-client-prefix", f.client_id],
    enabled: isTotvs && !!f.client_id,
    queryFn: async () => (await supabase.from("clients").select("cc_prefix").eq("id", f.client_id).maybeSingle()).data?.cc_prefix ?? null,
  });
  const totvsCcOf = (workId: string) => {
    const p = totvsPrefix.data;
    if (!p) return "—";
    if (workId === RATEIO_KEY) return `${p}999`;
    const w = (totvsWorks.data ?? []).find((x) => x.id === workId);
    return w?.cc_suffix ? `${p}${w.cc_suffix}` : "—";
  };
  const save = useMutation({
    mutationFn: async () => {
      checkHeader();
      if (isTotvs) {
        if (!totvs.number.trim()) throw new Error("Informe o número da SC do TOTVS.");
        if (!totvs.file) throw new Error(PRINT_REQUIRED);
        const path = `totvs/${crypto.randomUUID()}-${totvs.file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("purchase-photos").upload(path, totvs.file);
        if (up.error) throw up.error;
        const header = {
          ...f, justification: f.justification.trim(), delivery_place: f.delivery_kind === "outro" ? f.delivery_place.trim() : "",
          work_id: totvs.work === RATEIO_KEY ? "" : totvs.work, cc_code: totvs.cc.trim() || totvsCcOf(totvs.work).replace(/\D/g, ""),
        };
        const { data, error } = await supabase.rpc("purchase_request_create_totvs", { _number: totvs.number, _photo: path, _observers: f.observer_ids, _p: header as never });
        if (error) throw error;
        // Envia já: passa pela Validação como a da planilha (ou vai direto ao Comprador se o solicitante não precisa de validador).
        const sent = await supabase.rpc("purchase_request_send", { _id: data as string });
        if (sent.error) throw new Error(`SC do TOTVS salva como rascunho, mas não foi enviada: ${sent.error.message}`);
        totvsDest.current = sent.data as string;
        return data as string;
      }
      const payload = { ...f, justification: f.justification.trim(), delivery_place: f.delivery_kind === "outro" ? f.delivery_place.trim() : "" };
      if (editing) {
        const { error } = await supabase.from("purchase_requests").update({
          category: payload.category, nature: payload.nature, priority: payload.priority, client_id: payload.client_id,
          due_date: payload.due_date, delivery_kind: payload.delivery_kind, delivery_place: payload.delivery_place || null, notes: payload.notes.trim() || null,
          justification: payload.justification, observer_ids: payload.observer_ids,
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
      if (isTotvs) toast.success(totvsDest.current === "compras" ? "SC do TOTVS enviada para o Comprador" : "SC do TOTVS enviada para o validador");
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
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", isTotvs && totvsStep ? "max-w-md" : "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.number}` : isTotvs && totvsStep ? "SC do TOTVS" : "Nova solicitação de compra"}</DialogTitle>
          <DialogDescription>
            {editing ? "Controle da solicitação." : isTotvs && totvsStep ? "Informe o número da SC aberta no TOTVS, cole o print da solicitação e escolha o centro de custo. Ela vai para o validador (ou direto ao Comprador, se você não precisa de validador)."
              : "Data, solicitante e número (SC-NOME-001) são preenchidos sozinhos. Depois de salvar, você inclui os itens."}
          </DialogDescription>
        </DialogHeader>
        {!editing && !(isTotvs && totvsStep) && sel("Planilha ou TOTVS", "system", SC_SYSTEMS)}
        {isTotvs && totvsStep ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sc-totvs">Nº da SC no TOTVS</Label>
              <Input id="sc-totvs" value={totvs.number} onChange={(e) => setTotvs((t) => ({ ...t, number: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="block">Print da solicitação <span className="text-destructive">*</span></Label>
              <PastePrint file={totvs.file} onPaste={(file) => setTotvs((t) => ({ ...t, file }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div className="space-y-1">
                <Label>Centro de custo</Label>
                <SearchSelect value={totvs.work} onChange={(v) => setTotvs((t) => ({ ...t, work: v, cc: "" }))} searchPlaceholder="Digite o pedido, serviço ou CC"
                  options={[{ value: RATEIO_KEY, label: "Rateio geral do cliente" },
                    ...(totvsWorks.data ?? []).filter((w) => w.active).map((w) => {
                      const orders = (w.order_number ?? "").split(/[\s/;,]+/).filter(Boolean);
                      return { value: w.id, label: orders.length ? `${orders[0]}${orders.length > 1 ? "…" : ""} - ${w.name}` : w.name, hint: [w.order_number, totvsCcOf(w.id)].filter((v) => v && v !== "—").join(" ") };
                    })]} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-totvs-cc">CC</Label>
                <Input id="sc-totvs-cc" className="font-mono" value={totvs.cc} placeholder={totvsCcOf(totvs.work)} title="CC automático; digite para trocar"
                  onChange={(e) => setTotvs((t) => ({ ...t, cc: e.target.value.replace(/[^\w]/g, "") }))} />
              </div>
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
              <Label htmlFor="sc-just">Justificativa <span className="text-destructive">*</span></Label>
              <Textarea id="sc-just" rows={3} value={f.justification} onChange={(e) => set("justification", e.target.value)} placeholder="Por que esta compra é necessária" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sc-notes">Observações</Label>
              <Textarea id="sc-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
        )}
        {!(isTotvs && totvsStep) && <ObserversField value={f.observer_ids} onChange={(v) => set("observer_ids", v)} requesterId={editing?.requester_id} />}
        <DialogFooter>
          {isTotvs && totvsStep
            ? <Button variant="outline" onClick={() => setTotvsStep(false)}>Voltar</Button>
            : <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>}
          {isTotvs && !totvsStep
            ? <Button onClick={() => { try { checkHeader(); setTotvsStep(true); } catch (e) { toast.error((e as Error).message); } }}>Continuar</Button>
            : <Button disabled={save.isPending} onClick={() => save.mutate()}>{editing ? "Salvar" : isTotvs ? <><Send className="h-4 w-4" /> Enviar</> : "Criar e incluir itens"}</Button>}
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
            {row?.number}. {del ? "Ela ainda não foi enviada e será apagada com os itens." : "Ela já foi enviada: fica no histórico com o status CANCELADA e sai do validador e do Comprador."}
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

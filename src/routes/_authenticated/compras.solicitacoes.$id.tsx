import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Camera, Image as ImageIcon, Pencil, Plus, Save, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pill, ScHeaderDialog, todayISO, useClientsList, type ScRow } from "@/components/compras/sc-shared";
import {
  SC_ITEM_STATUSES, SC_UNITS, STAGE_LABEL, brDate, brl, budgetMissing, deadlineControl, deliveryLabel, priorityClass, statusClass, type ScStage,
} from "@/lib/purchase-requests";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/$id")({
  head: () => ({ meta: [{ title: "Solicitação de Compra | AB5 Hub" }, { name: "description", content: "Itens da solicitação de compra (modelo FR-CPS-SC)." }] }),
  component: Page,
});

type Item = Tables<"purchase_request_items">;
type Draft = { id?: string; quantity: string; unit: string; description: string; budget: string; notes: string; work_id: string; photo_path: string | null };
const RATEIO = "__rateio__";
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const toDraft = (i: Item): Draft => ({
  id: i.id, quantity: String(i.quantity).replace(".", ","), unit: i.unit, description: i.description, budget: i.budget == null ? "" : String(i.budget).replace(".", ","),
  notes: i.notes ?? "", work_id: i.work_id ?? RATEIO, photo_path: i.photo_path,
});
const emptyDraft = (): Draft => ({ quantity: "", unit: "UN", description: "", budget: "", notes: "", work_id: RATEIO, photo_path: null });

/**
 * Página da solicitação (modelo FR-CPS-SC): cabeçalho já preenchido pelo controle e a tabela de itens
 * (qtd, unidade, descrição, verba, observações, centro de custo = serviço do cliente ou rateio geral, foto).
 * O solicitante edita enquanto a SC está com ele; o comprador trata status e pedido de cada item.
 */
function Page() {
  const { id } = Route.useParams();
  const { user } = useCurrentUser();
  const { canAccess } = useAccess();
  const qc = useQueryClient();
  const req = useQuery({
    queryKey: ["sc-request", id],
    queryFn: async () => (await supabase.from("purchase_requests").select("*").eq("id", id).maybeSingle()).data as ScRow | null,
  });
  const items = useQuery({
    queryKey: ["sc-items", id],
    queryFn: async () => ((await supabase.from("purchase_request_items").select("*").eq("request_id", id).order("item_no")).data ?? []) as Item[],
  });
  const r = req.data;
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const works = useQuery({
    queryKey: ["sc-works", r?.client_id],
    enabled: !!r?.client_id,
    queryFn: async () => (await supabase.from("works").select("id, name, cc_suffix, active").eq("client_id", r!.client_id!).order("name")).data ?? [],
  });
  const workName = useMemo(() => new Map((works.data ?? []).map((w) => [w.id, w.name])), [works.data]);
  const editable = !!r && r.requester_id === user?.id && r.stage === "rascunho";
  const isBuyer = !!r && r.stage === "compras" && canAccess("/compras/comprador");

  const [rows, setRows] = useState<Draft[]>([]);
  const [total, setTotal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  useEffect(() => {
    if (!items.data || !r) return;
    setRows(items.data.length ? items.data.map(toDraft) : editable ? [emptyDraft()] : []);
    setTotal(r.total_budget == null ? "" : String(r.total_budget).replace(".", ","));
    setDirty(false);
  }, [items.data, r?.id, r?.total_budget, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (i: number, patch: Partial<Draft>) => { setRows((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const itemsTotal = rows.reduce((s, x) => s + (num(x.budget) ?? 0), 0);

  const saveItems = async () => {
    const filled = rows.filter((x) => x.description.trim() || x.quantity.trim());
    for (const [i, x] of filled.entries()) {
      if (!x.description.trim()) throw new Error(`Item ${i + 1}: escreva a descrição.`);
      if (!(num(x.quantity)! > 0)) throw new Error(`Item ${i + 1}: informe a quantidade.`);
    }
    const keep = new Set(filled.filter((x) => x.id).map((x) => x.id!));
    const remove = (items.data ?? []).filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (remove.length) { const { error } = await supabase.from("purchase_request_items").delete().in("id", remove); if (error) throw error; }
    for (const [i, x] of filled.entries()) {
      const payload = {
        request_id: id, item_no: i + 1, quantity: num(x.quantity)!, unit: x.unit.trim() || "UN", description: x.description.trim(),
        budget: num(x.budget), notes: x.notes.trim() || null, work_id: x.work_id === RATEIO ? null : x.work_id, photo_path: x.photo_path,
      };
      const { error } = x.id ? await supabase.from("purchase_request_items").update(payload).eq("id", x.id) : await supabase.from("purchase_request_items").insert(payload);
      if (error) throw error;
    }
    const { error } = await supabase.from("purchase_requests").update({ total_budget: num(total) }).eq("id", id);
    if (error) throw error;
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["sc-items", id] }); qc.invalidateQueries({ queryKey: ["sc-request", id] }); qc.invalidateQueries({ queryKey: ["sc-requests"] }); };
  const save = useMutation({ mutationFn: saveItems, onSuccess: () => { toast.success("Itens salvos"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const send = useMutation({
    mutationFn: async () => {
      const filled = rows.filter((x) => x.description.trim() || x.quantity.trim());
      if (budgetMissing(r!.nature, num(total), filled.map((x) => num(x.budget)))) throw new Error("Informe a verba de cada item ou a verba total (só a natureza PROGRAMADA dispensa).");
      await saveItems();
      const { error } = await supabase.rpc("purchase_request_send", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Enviada para o aprovador"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setItem = useMutation({
    mutationFn: async ({ item, status, order }: { item: string; status: string; order: string }) => {
      const { error } = await supabase.rpc("purchase_item_set", { _item: item, _status: status, _order: order });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Item atualizado"); qc.invalidateQueries({ queryKey: ["sc-items", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [orders, setOrders] = useState<Record<string, string>>({});

  const upload = async (i: number, file: File) => {
    const path = `${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("purchase-photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    change(i, { photo_path: path });
    toast.success("Foto anexada (salve os itens)");
  };
  const openPhoto = async (path: string) => {
    const { data, error } = await supabase.storage.from("purchase-photos").createSignedUrl(path, 600);
    if (error || !data) { toast.error(error?.message ?? "Foto indisponível"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  if (req.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!r) return <p className="text-sm text-muted-foreground">Solicitação não encontrada ou sem acesso.</p>;
  const dl = deadlineControl(r, todayISO());
  const cName = r.client_id ? clientName.get(r.client_id) ?? "—" : "—";
  // Cabeçalho em colunas, como o modelo FR-CPS-SC: quem/quando · o quê · para onde/quando entregar · andamento.
  const created = new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const headCols: [string, React.ReactNode][][] = [
    [["Data da SC", brDate(r.request_date)], ["Horário", created], ["Requisitante", r.requester_name]],
    [["Categoria", r.category], ["Natureza da compra", r.nature], ["Prioridade", <Pill key="p" className={priorityClass(r.priority)}>{r.priority}</Pill>]],
    [["Cliente", cName], ["Prazo de entrega", brDate(r.due_date)], ["Local de entrega", deliveryLabel(r, cName)]],
    [
      ["Envio", r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "não enviado"],
      ["Controle de prazo", <Pill key="d" className={dl.cls}>{dl.label}</Pill>],
      ["Etapa / status", <span key="s" className="space-x-1">{STAGE_LABEL[r.stage as ScStage]} <Pill className={statusClass(r.status)}>{r.status}</Pill> <span className="text-xs text-muted-foreground">{brDate(r.status_at)}</span></span>],
    ],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild><Link to="/compras/solicitacoes"><ArrowLeft className="h-4 w-4" /> Solicitações</Link></Button>
        <h1 className="font-display text-xl font-semibold uppercase tracking-wide">{r.number}</h1>
        <div className="ml-auto flex gap-2">
          {editable && <Button variant="outline" size="sm" onClick={() => setEditingHeader(true)}><Pencil className="h-4 w-4" /> Editar cabeçalho</Button>}
          {editable && <Button variant="outline" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Salvar itens</Button>}
          {editable && <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" /> Enviar</Button>}
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-border pb-2">
          <span className="text-sm font-semibold">Ab5 Indústria e Comércio LTDA</span>
          <span className="font-display text-sm uppercase tracking-wide">Solicitação de compras</span>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
          {headCols.map((col, i) => (
            <dl key={i} className="space-y-2 lg:pl-4 lg:first:pl-0">
              {col.map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            </dl>
          ))}
        </div>
        {r.notes && <p className="mt-3 rounded-md bg-muted p-2 text-xs"><b>Observações:</b> {r.notes}</p>}
        {r.approver_notes && <p className={`mt-2 rounded-md p-2 text-xs ${r.stage === "rascunho" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}><b>Aprovador:</b> {r.approver_notes}</p>}
        {r.buyer_notes && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><b>Comprador:</b> {r.buyer_notes}</p>}
      </div>

      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Item</TableHead>
              <TableHead className="w-20">Qtd</TableHead>
              <TableHead className="w-24">Un. medida</TableHead>
              <TableHead className="min-w-64">Descrição</TableHead>
              <TableHead className="w-28">Verba (R$)</TableHead>
              <TableHead className="min-w-40">Observações</TableHead>
              <TableHead className="min-w-48">Centro de custo</TableHead>
              <TableHead className="w-16">Foto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="min-w-32">Pedido de compras AB5</TableHead>
              {editable && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">Nenhum item.</TableCell></TableRow>}
            {rows.map((x, i) => {
              const saved = x.id ? (items.data ?? []).find((it) => it.id === x.id) : undefined;
              return (
                <TableRow key={x.id ?? `new-${i}`}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{editable ? <Input className="h-8" inputMode="decimal" value={x.quantity} onChange={(e) => change(i, { quantity: e.target.value })} /> : x.quantity}</TableCell>
                  <TableCell>
                    {editable ? (
                      <>
                        <Input className="h-8" list="sc-units" value={x.unit} onChange={(e) => change(i, { unit: e.target.value.toUpperCase() })} />
                        <datalist id="sc-units">{SC_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                      </>
                    ) : x.unit}
                  </TableCell>
                  <TableCell>{editable ? <Input className="h-8" value={x.description} onChange={(e) => change(i, { description: e.target.value })} /> : x.description}</TableCell>
                  <TableCell>{editable ? <Input className="h-8" inputMode="decimal" placeholder="0,00" value={x.budget} onChange={(e) => change(i, { budget: e.target.value })} /> : brl(num(x.budget))}</TableCell>
                  <TableCell>{editable ? <Input className="h-8" value={x.notes} onChange={(e) => change(i, { notes: e.target.value })} /> : x.notes || "—"}</TableCell>
                  <TableCell>
                    {editable ? (
                      <Select value={x.work_id} onValueChange={(v) => change(i, { work_id: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value={RATEIO}>Rateio geral do cliente</SelectItem>
                          {(works.data ?? []).filter((w) => w.active || w.id === x.work_id).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : x.work_id === RATEIO ? "Rateio geral" : workName.get(x.work_id) ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {x.photo_path && <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver foto" onClick={() => openPhoto(x.photo_path!)}><ImageIcon className="h-4 w-4" /></Button>}
                      {editable && (
                        <label className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent" title="Anexar foto">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} />
                        </label>
                      )}
                      {!x.photo_path && !editable && <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isBuyer && saved ? (
                      <Select value={saved.status} onValueChange={(v) => setItem.mutate({ item: saved.id, status: v, order: orders[saved.id] ?? saved.order_number ?? "" })}>
                        <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{SC_ITEM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <span className="whitespace-nowrap">{saved?.status ?? (r.stage === "rascunho" ? "—" : "SOLICITAÇÃO ENVIADA")}</span>}
                  </TableCell>
                  <TableCell>
                    {isBuyer && saved ? (
                      <Input className="h-8" value={orders[saved.id] ?? saved.order_number ?? ""} onChange={(e) => setOrders((o) => ({ ...o, [saved.id]: e.target.value }))}
                        onBlur={() => { const v = orders[saved.id]; if (v !== undefined && v !== (saved.order_number ?? "")) setItem.mutate({ item: saved.id, status: saved.status, order: v }); }} />
                    ) : saved?.order_number ?? "—"}
                  </TableCell>
                  {editable && (
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Tirar item" onClick={() => { setRows((s) => s.filter((_, j) => j !== i)); setDirty(true); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right">Verba dos itens</TableCell>
              <TableCell className="tabular-nums">{brl(itemsTotal)}</TableCell>
              <TableCell colSpan={editable ? 6 : 5} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {editable && <Button variant="outline" size="sm" onClick={() => { setRows((s) => [...s, emptyDraft()]); setDirty(true); }}><Plus className="h-4 w-4" /> Adicionar item</Button>}
        <div className="space-y-1">
          <Label htmlFor="sc-total" className="text-xs">Verba total (se não informar por item)</Label>
          {editable
            ? <Input id="sc-total" className="w-44" inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => { setTotal(e.target.value); setDirty(true); }} />
            : <p className="text-sm font-medium">{brl(r.total_budget)}</p>}
        </div>
        {editable && (
          <p className="text-xs text-muted-foreground">
            {r.nature.toUpperCase() === "PROGRAMADA" ? "Natureza PROGRAMADA: a verba não é obrigatória." : "Obrigatório: a verba de cada item ou a verba total."}
          </p>
        )}
      </div>

      <ScHeaderDialog open={editingHeader} onOpenChange={setEditingHeader} editing={r} />
    </div>
  );
}

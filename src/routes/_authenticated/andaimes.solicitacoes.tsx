import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useAndamScope } from "@/hooks/use-andam-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRIORITY, PURCHASE_STATUS, REQ_STATUS, separationStatus, shortage } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/solicitacoes")({
  head: () => ({
    meta: [
      { title: "Solicitações de Andaimes | AB5 Hub" },
      { name: "description", content: "Pedidos de materiais de andaime para as obras, com separação e compras." },
      { property: "og:title", content: "Solicitações de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Solicitações de materiais, disponibilidade, separação e compra necessária." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const CANTEIRO = "__canteiro";
const ALL = "__all";
const fmtDate = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const OPEN = ["aberta", "em_analise", "aguardando_separacao", "em_separacao", "parcialmente_separada", "separada", "compra_necessaria", "compra_realizada"];
const CARDS: { key: string; label: string; test: (r: any) => boolean }[] = [
  { key: "abertas", label: "Solicitações abertas", test: (r) => OPEN.includes(r.status) },
  { key: "aguardando", label: "Aguardando separação", test: (r) => r.status === "aguardando_separacao" },
  { key: "compra", label: "Compra necessária", test: (r) => r.status === "compra_necessaria" },
  { key: "parcial", label: "Atendimento parcial", test: (r) => r.status === "parcialmente_separada" },
  { key: "transito", label: "Em trânsito", test: (r) => r.status === "em_transito" },
  { key: "urgentes", label: "Urgentes", test: (r) => r.priority === "urgente" && OPEN.includes(r.status) },
];

function useCentral() {
  return useQuery({
    queryKey: ["andam-central"],
    queryFn: async () => {
      const { data } = await supabase.from("andam_stock").select("item_id, quantity").eq("location", "central");
      const m = new Map<string, number>();
      (data ?? []).forEach((s) => m.set(s.item_id, (m.get(s.item_id) ?? 0) + Number(s.quantity)));
      return m;
    },
  });
}

function Page() {
  const { clients, works, user, isAdmin, canEdit } = useAndamScope();
  const qc = useQueryClient();
  const [card, setCard] = useState<string | null>(null);
  const [fClient, setFClient] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fPrio, setFPrio] = useState(ALL);
  const [form, setForm] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["andam-req"],
    queryFn: async () => (await supabase.from("andam_requests").select("*, clients(name), works(name)").order("number", { ascending: false })).data ?? [],
  });
  const rows = list.data ?? [];
  const filtered = useMemo(() => rows.filter((r: any) => {
    if (card && !CARDS.find((c) => c.key === card)!.test(r)) return false;
    if (fClient !== ALL && r.client_id !== fClient) return false;
    if (fStatus !== ALL && r.status !== fStatus) return false;
    if (fPrio !== ALL && r.priority !== fPrio) return false;
    return true;
  }), [rows, card, fClient, fStatus, fPrio]);

  const remove = async (r: any) => {
    if (!confirm(`Excluir a solicitação nº ${r.number}?`)) return;
    const { error } = await supabase.from("andam_requests").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Solicitação excluída"); qc.invalidateQueries({ queryKey: ["andam-req"] });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Pedidos de materiais de andaime para as obras."
        actions={canEdit ? <Button onClick={() => setForm({ client: "", work: CANTEIRO, request_date: new Date().toISOString().slice(0, 10), needed_date: "", priority: "normal", notes: "", lines: [{ item: "", qty: "" }] })}><Plus className="mr-1 h-4 w-4" />Nova solicitação</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {CARDS.map((c) => (
          <Card key={c.key} className={`cursor-pointer transition-colors ${card === c.key ? "border-primary" : ""}`} onClick={() => setCard(card === c.key ? null : c.key)}>
            <CardContent className="p-4"><div className="text-xs text-muted-foreground">{c.label}</div><div className="text-2xl font-semibold">{rows.filter(c.test).length}</div></CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Filter value={fClient} onChange={setFClient} placeholder="Todos os clientes" options={clients.map((c) => [c.id, c.name])} />
        <Filter value={fStatus} onChange={setFStatus} placeholder="Todos os status" options={Object.entries(REQ_STATUS)} />
        <Filter value={fPrio} onChange={setFPrio} placeholder="Todas as prioridades" options={Object.entries(PRIORITY)} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço / Canteiro</TableHead><TableHead>Solicitada em</TableHead><TableHead>Necessária em</TableHead><TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.number}</TableCell>
                <TableCell>{r.clients?.name}</TableCell>
                <TableCell>{r.works?.name ?? "Canteiro"}</TableCell>
                <TableCell>{fmtDate(r.request_date)}</TableCell>
                <TableCell>{fmtDate(r.needed_date)}</TableCell>
                <TableCell><Badge variant={r.priority === "urgente" ? "destructive" : "outline"}>{PRIORITY[r.priority]}</Badge></TableCell>
                <TableCell><Badge variant={r.status === "compra_necessaria" ? "destructive" : r.status === "atendida" ? "default" : "secondary"}>{REQ_STATUS[r.status]}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button size="icon" variant="ghost" title="Ver detalhes" onClick={() => setOpen(r.id)}><Eye className="h-4 w-4" /></Button>
                  {canEdit && (["aberta", "em_analise", "cancelada"].includes(r.status) || isAdmin) && <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Nenhuma solicitação.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {form && <NewDialog form={form} setForm={setForm} clients={clients} works={works} userId={user?.id} onDone={(id: string) => { setForm(null); qc.invalidateQueries({ queryKey: ["andam-req"] }); setOpen(id); }} />}
      {open && <RequestDialog id={open} canEdit={canEdit} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["andam-req"] }); }} />}
    </div>
  );
}

function NewDialog({ form, setForm, clients, works, userId, onDone }: any) {
  const items = useQuery({ queryKey: ["andam-items-active"], queryFn: async () => (await supabase.from("andam_items").select("id, name, unit").eq("active", true).order("name")).data ?? [] });
  const central = useCentral();
  const avail = (id: string) => central.data?.get(id) ?? 0;
  const setLine = (i: number, k: string, v: string) => setForm({ ...form, lines: form.lines.map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)) });
  const save = async () => {
    if (!form.client) { toast.error("Informe o cliente"); return; }
    const lines = form.lines.filter((l: any) => l.item && Number(l.qty) > 0);
    if (!lines.length) { toast.error("Inclua ao menos um material"); return; }
    if (new Set(lines.map((l: any) => l.item)).size !== lines.length) { toast.error("Material repetido na lista"); return; }
    const lacking = lines.some((l: any) => Number(l.qty) > avail(l.item));
    const { data: req, error } = await supabase.from("andam_requests").insert({
      client_id: form.client, work_id: form.work !== CANTEIRO ? form.work : null, request_date: form.request_date,
      needed_date: form.needed_date || null, priority: form.priority, notes: form.notes || null, user_id: userId ?? null,
      status: lacking ? "compra_necessaria" : "aguardando_separacao",
    }).select().single();
    if (error || !req) { toast.error(error?.message ?? "Erro"); return; }
    const { error: e2 } = await supabase.from("andam_request_items").insert(lines.map((l: any) => ({
      request_id: req.id, item_id: l.item, requested_qty: Number(l.qty), purchase_status: Number(l.qty) > avail(l.item) ? "compra_necessaria" : null,
    })));
    if (e2) { toast.error(e2.message); return; }
    toast.success(`Solicitação nº ${req.number} criada`); onDone(req.id);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && setForm(null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Nova solicitação</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Pick label="Cliente" value={form.client} onChange={(v) => setForm({ ...form, client: v, work: CANTEIRO })} options={clients.map((c: any) => [c.id, c.name])} />
          <Pick label="Serviço ou Canteiro" value={form.work} onChange={(v) => setForm({ ...form, work: v })} options={[[CANTEIRO, "Canteiro"], ...works.filter((w: any) => w.client_id === form.client).map((w: any) => [w.id, w.name])]} />
          <div className="space-y-1"><Label>Data da solicitação</Label><Input type="date" value={form.request_date} onChange={(e) => setForm({ ...form, request_date: e.target.value })} /></div>
          <div className="space-y-1"><Label>Data necessária</Label><Input type="date" value={form.needed_date} onChange={(e) => setForm({ ...form, needed_date: e.target.value })} /></div>
          <Pick label="Prioridade" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={Object.entries(PRIORITY)} />
          <div className="space-y-1"><Label>Observação</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div className="max-h-[40vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Material</TableHead><TableHead className="w-28 text-right">Solicitado</TableHead><TableHead className="text-right">Disponível</TableHead><TableHead className="text-right">Falta</TableHead><TableHead>Situação</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {form.lines.map((l: any, i: number) => {
                const f = l.item ? shortage(Number(l.qty || 0), avail(l.item)) : 0;
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <Select {...(l.item ? { value: l.item } : {})} onValueChange={(v) => setLine(i, "item", v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{(items.data ?? []).map((it: any) => <SelectItem key={it.id} value={it.id}>{it.name} ({it.unit})</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" min={0} className="h-8 text-right" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} /></TableCell>
                    <TableCell className="text-right">{l.item ? avail(l.item).toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${f > 0 ? "text-destructive" : ""}`}>{l.item ? f.toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell>{l.item && Number(l.qty) > 0 ? (f > 0 ? <Badge variant="destructive">Compra necessária</Badge> : <Badge variant="secondary">Disponível</Badge>) : "—"}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => setForm({ ...form, lines: form.lines.filter((_: any, j: number) => j !== i) })}><X className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => setForm({ ...form, lines: [...form.lines, { item: "", qty: "" }] })}><Plus className="mr-1 h-4 w-4" />Material</Button>
          <Button onClick={save}>Criar solicitação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDialog({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const central = useCentral();
  const head = useQuery({ queryKey: ["andam-req-one", id], queryFn: async () => (await supabase.from("andam_requests").select("*, clients(name), works(name)").eq("id", id).single()).data });
  const lines = useQuery({ queryKey: ["andam-req-items", id], queryFn: async () => (await supabase.from("andam_request_items").select("*, andam_items(name, unit)").eq("request_id", id)).data ?? [] });
  const h: any = head.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["andam-req-one", id] }); qc.invalidateQueries({ queryKey: ["andam-req-items", id] }); qc.invalidateQueries({ queryKey: ["andam-req"] }); };
  if (!h) return null;
  const separating = h.status === "em_separacao";
  const closed = ["em_transito", "recebida", "atendida", "cancelada"].includes(h.status);
  const avail = (it: string) => central.data?.get(it) ?? 0;
  const sorted = [...(lines.data ?? [])].sort((a: any, b: any) => a.andam_items.name.localeCompare(b.andam_items.name, "pt-BR"));

  const setStatus = async (status: string) => {
    const { error } = await supabase.from("andam_requests").update({ status }).eq("id", id);
    if (error) toast.error(error.message); refresh();
  };
  const updLine = async (lid: string, patch: any) => {
    const { error } = await supabase.from("andam_request_items").update(patch).eq("id", lid);
    if (error) toast.error(error.message); refresh();
  };
  const finish = async () => {
    const ls = sorted.map((l: any) => ({ requested: Number(l.requested_qty), separated: Number(l.separated_qty), available: avail(l.item_id) }));
    if (sorted.some((l: any) => Number(l.separated_qty) > avail(l.item_id))) { toast.error("Separado maior que o disponível no estoque central"); return; }
    for (const l of sorted as any[]) if (Number(l.separated_qty) < Number(l.requested_qty) && !l.purchase_status && avail(l.item_id) < Number(l.requested_qty)) await supabase.from("andam_request_items").update({ purchase_status: "compra_necessaria" }).eq("id", l.id);
    await setStatus(separationStatus(ls));
    toast.success("Separação concluída");
  };
  const romaneio = async () => {
    const sep = sorted.filter((l: any) => Number(l.separated_qty) > 0);
    if (!sep.length) { toast.error("Nada separado para enviar"); return; }
    const { data: rom, error } = await supabase.from("andam_romaneios").insert({ request_id: id, client_id: h.client_id, work_id: h.work_id }).select().single();
    if (error || !rom) { toast.error(error?.message ?? "Erro"); return; }
    const { error: e2 } = await supabase.from("andam_romaneio_items").insert(sep.map((l: any) => ({ romaneio_id: rom.id, item_id: l.item_id, requested_qty: l.requested_qty, separated_qty: l.separated_qty, sent_qty: l.separated_qty })));
    if (e2) { toast.error(e2.message); return; }
    toast.success("Romaneio gerado"); navigate({ to: "/andaimes/romaneios" });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Solicitação nº {h.number} — {h.clients?.name} · {h.works?.name ?? "Canteiro"}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">
          Solicitada em {fmtDate(h.request_date)} · Necessária em {fmtDate(h.needed_date)} · Prioridade {PRIORITY[h.priority]} · <b>{REQ_STATUS[h.status]}</b>
          {h.notes && <div>Obs.: {h.notes}</div>}
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>Material</TableHead><TableHead className="text-right">Solicitado</TableHead><TableHead className="text-right">Disponível</TableHead><TableHead className="w-28 text-right">Separado</TableHead><TableHead className="text-right">Falta</TableHead><TableHead className="w-48">Compra</TableHead></TableRow></TableHeader>
            <TableBody>
              {sorted.map((l: any) => {
                const f = Math.max(0, Number(l.requested_qty) - Number(l.separated_qty));
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.andam_items.name} <span className="text-xs text-muted-foreground">{l.andam_items.unit}</span></TableCell>
                    <TableCell className="text-right">{Number(l.requested_qty).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">{avail(l.item_id).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      {canEdit && separating
                        ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l.separated_qty} onBlur={(e) => Number(e.target.value) !== Number(l.separated_qty) && updLine(l.id, { separated_qty: Number(e.target.value || 0) })} />
                        : Number(l.separated_qty).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${f > 0 ? "text-destructive" : ""}`}>{f.toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      {canEdit && !closed && l.purchase_status
                        ? <Select value={l.purchase_status} onValueChange={(v) => updLine(l.id, { purchase_status: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{Object.entries(PURCHASE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                          </Select>
                        : l.purchase_status ? PURCHASE_STATUS[l.purchase_status] : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {canEdit && !closed && (
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={() => confirm("Cancelar esta solicitação?") && setStatus("cancelada")}>Cancelar solicitação</Button>
            {h.status === "aberta" && <Button variant="outline" onClick={() => setStatus("em_analise")}>Em análise</Button>}
            {h.status === "compra_necessaria" && <Button variant="outline" onClick={() => setStatus("compra_realizada")}>Compra realizada</Button>}
            {!separating && <Button variant="outline" onClick={() => setStatus("em_separacao")}>Iniciar separação</Button>}
            {separating && <Button onClick={finish}>Concluir separação</Button>}
            {["separada", "parcialmente_separada", "compra_necessaria", "compra_realizada"].includes(h.status) && sorted.some((l: any) => Number(l.separated_qty) > 0) && <Button onClick={romaneio}>Gerar romaneio</Button>}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Filter({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>{placeholder}</SelectItem>{options.map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useAccess } from "@/hooks/use-access";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INV_STATUS, invDiff } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/inventario")({
  head: () => ({
    meta: [
      { title: "Inventário de Andaimes | AB5 Hub" },
      { name: "description", content: "Contagem física dos materiais de andaime em cada obra." },
      { property: "og:title", content: "Inventário de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Inventários por cliente e serviço, com diferenças e histórico." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const CANTEIRO = "__canteiro";
const PATIO = "__patio";
const isPatioName = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase() === "PATIO";
const fmtDate = (d: string) => d.split("-").reverse().join("/");

function Page() {
  const { canWrite: cw, isForeman, isAdmin, role, user } = useCurrentUser();
  const { canAccess } = useAccess();
  const canWrite = isAdmin || canAccess("/andaimes/inventario");
  const scoped = role === "coordenador" || role === "encarregado";
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["andam-inv"],
    queryFn: async () => (await supabase.from("andam_inventory").select("*, clients(name), works(name), andam_inventory_items(count)").order("number", { ascending: false })).data ?? [],
  });
  const users = useQuery({ queryKey: ["andam-users"], queryFn: async () => (await supabase.from("users_profiles").select("id, full_name")).data ?? [] });
  const clients = useQuery({ queryKey: ["andam-clients", user?.id, scoped], enabled: !!user?.id, queryFn: async () => {
    const all = (await supabase.from("clients").select("id, name").eq("active", true).order("name")).data ?? [];
    if (!scoped) return all;
    const { data: links } = await supabase.from("foreman_works").select("works(client_id)").eq("user_id", user!.id);
    const ids = new Set((links ?? []).map((l: any) => l.works?.client_id).filter(Boolean));
    return all.filter((c) => ids.has(c.id));
  } });
  const remove = async (i: any) => {
    if (!confirm(`Excluir o inventário nº ${i.number}?`)) return;
    const { error } = await supabase.from("andam_inventory").delete().eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário excluído"); qc.invalidateQueries({ queryKey: ["andam-inv"] });
  };
  const works = useQuery({ queryKey: ["andam-works"], queryFn: async () => (await supabase.from("works").select("id, name, client_id").order("name")).data ?? [] });
  const [form, setForm] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const userName = (id: string) => users.data?.find((u: any) => u.id === id)?.full_name ?? "—";

  const create = async () => {
    if (!form.client) { toast.error("Informe o cliente"); return; }
    const patio = form.client === PATIO;
    const clientId = patio ? null : form.client;
    const workId = !patio && form.work && form.work !== CANTEIRO ? form.work : null;
    const { data: inv, error } = await supabase.from("andam_inventory").insert({ location: patio ? "central" : "obra", client_id: clientId, work_id: workId, inventory_date: form.date, notes: form.notes || null, user_id: user?.id ?? null }).select().single();
    if (error || !inv) { toast.error(error?.message ?? "Erro"); return; }
    // Carrega os materiais registrados na obra (todos os ativos, com a quantidade atual)
    const [{ data: items }, { data: stock }] = await Promise.all([
      supabase.from("andam_items").select("id").eq("active", true),
      (patio ? supabase.from("andam_stock").select("item_id, quantity").eq("location", "central").is("client_id", null).is("work_id", null)
        : workId ? supabase.from("andam_stock").select("item_id, quantity").eq("location", "obra").eq("client_id", clientId!).eq("work_id", workId)
        : supabase.from("andam_stock").select("item_id, quantity").eq("location", "obra").eq("client_id", clientId!).is("work_id", null)),
    ]);
    const rows = (items ?? []).map((i: any) => ({ inventory_id: inv.id, item_id: i.id, system_qty: Number(stock?.find((s: any) => s.item_id === i.id)?.quantity ?? 0) }));
    if (rows.length) await supabase.from("andam_inventory_items").insert(rows);
    setForm(null); qc.invalidateQueries({ queryKey: ["andam-inv"] }); setOpen(inv);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Inventário" description="Contagem física dos materiais de andaime em cada obra."
        actions={canWrite ? <Button onClick={() => setForm({ client: "", work: CANTEIRO, date: new Date().toISOString().slice(0, 10), notes: "" })}><Plus className="mr-1 h-4 w-4" />Novo inventário</Button> : undefined} />
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço</TableHead><TableHead>Data</TableHead><TableHead>Responsável</TableHead><TableHead className="text-right">Itens</TableHead><TableHead>Status</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((i: any) => (
              <TableRow key={i.id}>
                <TableCell>{i.number}</TableCell>
                <TableCell>{i.location === "central" ? "PATIO" : i.clients?.name}</TableCell>
                <TableCell>{i.location === "central" ? "PATIO" : i.works?.name ?? "Canteiro"}</TableCell>
                <TableCell>{fmtDate(i.inventory_date)}</TableCell>
                <TableCell>{userName(i.user_id)}</TableCell>
                <TableCell className="text-right">{i.andam_inventory_items?.[0]?.count ?? 0}</TableCell>
                <TableCell><Badge variant={i.status === "finalizado" ? "default" : i.status === "cancelado" ? "secondary" : "outline"}>{INV_STATUS[i.status]}</Badge></TableCell>
                <TableCell><div className="flex items-center gap-1">
                  {canWrite && (i.status !== "finalizado" || isAdmin) && <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  <Button size="icon" variant="ghost" title={i.status === "em_andamento" ? "Continuar" : "Ver detalhes"} onClick={() => setOpen(i)}><Eye className="h-4 w-4" /></Button>
                </div></TableCell>
              </TableRow>
            ))}
            {!list.data?.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Nenhum inventário.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo inventário</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <Pick label="Cliente" value={form.client} onChange={(v) => setForm({ ...form, client: v, work: CANTEIRO })} options={[...(!scoped || (clients.data ?? []).some((c: any) => isPatioName(c.name)) ? [[PATIO, "PATIO (Estoque Central)"]] : []), ...(clients.data ?? []).filter((c: any) => !isPatioName(c.name)).map((c: any) => [c.id, c.name])]} />
              {form.client === PATIO
                ? <div className="space-y-1"><Label>Serviço</Label><Input value="PATIO" disabled /></div>
                : <Pick label="Serviço" value={form.work} onChange={(v) => setForm({ ...form, work: v })} options={[[CANTEIRO, "Canteiro"], ...(works.data ?? []).filter((w: any) => w.client_id === form.client).map((w: any) => [w.id, w.name])]} />}
              <div className="space-y-1"><Label>Data</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="space-y-1"><Label>Observação</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={create}>Continuar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {open && <InventoryDialog inv={open} canWrite={canWrite} userName={userName} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["andam-inv"] }); }} />}
    </div>
  );
}

function InventoryDialog({ inv, canWrite, userName, onClose }: { inv: any; canWrite: boolean; userName: (id: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const head = useQuery({ queryKey: ["andam-inv-one", inv.id], queryFn: async () => (await supabase.from("andam_inventory").select("*, clients(name), works(name)").eq("id", inv.id).single()).data });
  const lines = useQuery({ queryKey: ["andam-inv-items", inv.id], queryFn: async () => (await supabase.from("andam_inventory_items").select("*, andam_items(name, code, unit)").eq("inventory_id", inv.id)).data ?? [] });
  const h = head.data ?? inv;
  const editable = canWrite && h.status === "em_andamento";
  const sorted = [...(lines.data ?? [])].sort((a: any, b: any) => a.andam_items.name.localeCompare(b.andam_items.name, "pt-BR"));

  const setCount = async (id: string, v: string) => {
    const { error } = await supabase.from("andam_inventory_items").update({ counted_qty: v === "" ? null : Number(v) }).eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["andam-inv-items", inv.id] });
  };
  const finalize = async () => {
    if (!confirm("Finalizar o inventário? As quantidades da obra serão atualizadas e não poderão mais ser alteradas.")) return;
    const { error } = await supabase.rpc("andam_finalize_inventory", { _inv: inv.id } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário finalizado"); qc.invalidateQueries({ queryKey: ["andam-stock"] }); onClose();
  };
  const cancel = async () => {
    if (!confirm("Cancelar este inventário?")) return;
    const { error } = await supabase.from("andam_inventory").update({ status: "cancelado" }).eq("id", inv.id);
    if (error) { toast.error(error.message); return; }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Inventário nº {h.number} — {h.location === "central" ? "PATIO" : `${h.clients?.name} · ${h.works?.name ?? "Canteiro"}`}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">
          {fmtDate(h.inventory_date)} · {INV_STATUS[h.status]} · Responsável: {userName(h.user_id)}
          {h.finalized_at && <> · Finalizado em {new Date(h.finalized_at).toLocaleString("pt-BR")} por {userName(h.finalized_by)}</>}
          {h.notes && <div>Obs.: {h.notes}</div>}
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>Material</TableHead><TableHead className="text-right">Qtd. no sistema</TableHead><TableHead className="w-36 text-right">Qtd. contada</TableHead><TableHead className="text-right">Diferença</TableHead></TableRow></TableHeader>
            <TableBody>
              {sorted.map((l: any) => {
                const d = invDiff(l.counted_qty, l.system_qty);
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.andam_items.name} <span className="text-xs text-muted-foreground">{l.andam_items.unit}</span></TableCell>
                    <TableCell className="text-right">{Number(l.system_qty).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      {editable
                        ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l.counted_qty ?? ""} onBlur={(e) => e.target.value !== String(l.counted_qty ?? "") && setCount(l.id, e.target.value)} />
                        : l.counted_qty ?? "—"}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${d && d < 0 ? "text-destructive" : ""}`}>{d == null ? "—" : `${d > 0 ? "+" : ""}${d.toLocaleString("pt-BR")}`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {editable && (
          <DialogFooter>
            <Button variant="ghost" onClick={cancel}>Cancelar inventário</Button>
            <Button onClick={finalize}>Finalizar inventário</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
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

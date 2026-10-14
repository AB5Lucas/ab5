import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, History, Plus, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LOCATIONS, locLabel } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque de Andaimes | AB5 Hub" },
      { name: "description", content: "Quantidades e localização dos materiais de andaime." },
      { property: "og:title", content: "Estoque de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Estoque central, obras, trânsito, manutenção e danificados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const ALL = "__all";
const CANTEIRO = "__canteiro";

function Page() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["andam-items"], queryFn: async () => (await supabase.from("andam_items").select("*").order("name")).data ?? [] });
  const stock = useQuery({ queryKey: ["andam-stock"], queryFn: async () => (await supabase.from("andam_stock").select("*")).data ?? [] });
  const clients = useQuery({ queryKey: ["andam-clients"], queryFn: async () => (await supabase.from("clients").select("id, name").eq("active", true).order("name")).data ?? [] });
  const works = useQuery({ queryKey: ["andam-works"], queryFn: async () => (await supabase.from("works").select("id, name, client_id").order("name")).data ?? [] });

  const [f, setF] = useState({ client: ALL, work: ALL, item: ALL, category: ALL, location: ALL });
  const [adjust, setAdjust] = useState<any>(null);
  const [transfer, setTransfer] = useState<any>(null);
  const [newItem, setNewItem] = useState<any>(null);
  const [moves, setMoves] = useState<any>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["andam-stock"] }); qc.invalidateQueries({ queryKey: ["andam-items"] }); qc.invalidateQueries({ queryKey: ["andam-moves"] }); };

  const categories = [...new Set((items.data ?? []).map((i: any) => i.category).filter(Boolean))] as string[];
  const rows = useMemo(() => (stock.data ?? []).filter((s: any) => {
    const it = (items.data ?? []).find((i: any) => i.id === s.item_id);
    if (f.client !== ALL && s.client_id !== f.client) return false;
    if (f.work === CANTEIRO ? s.work_id !== null || s.location !== "obra" : f.work !== ALL && s.work_id !== f.work) return false;
    if (f.item !== ALL && s.item_id !== f.item) return false;
    if (f.category !== ALL && it?.category !== f.category) return false;
    return true;
  }), [stock.data, items.data, f]);
  const totals = (loc: string) => rows.filter((r: any) => r.location === loc).reduce((a: number, r: any) => a + Number(r.quantity), 0);
  const table = (items.data ?? [])
    .filter((i: any) => (f.item === ALL || i.id === f.item) && (f.category === ALL || i.category === f.category))
    .map((i: any) => {
      const by: Record<string, number> = {};
      rows.filter((r: any) => r.item_id === i.id).forEach((r: any) => { by[r.location] = (by[r.location] ?? 0) + Number(r.quantity); });
      return { item: i, by, total: Object.values(by).reduce((a, b) => a + b, 0) };
    })
    .filter((r) => f.location === ALL || (r.by[f.location] ?? 0) > 0);
  const cols = f.location === ALL ? LOCATIONS : LOCATIONS.filter((l) => l.key === f.location);
  const worksOf = (c: string) => (works.data ?? []).filter((w: any) => c === ALL || w.client_id === c);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estoque"
        description="Quantidade de materiais de andaime e onde eles estão."
        actions={canWrite ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setNewItem({ name: "", code: "", category: "", unit: "un", min_stock: "0" })}><Plus className="mr-1 h-4 w-4" />Material</Button>
            <Button variant="outline" onClick={() => setTransfer({ item: "", from: "central", fromClient: "", fromWork: CANTEIRO, to: "obra", toClient: "", toWork: CANTEIRO, qty: "", note: "" })}><ArrowLeftRight className="mr-1 h-4 w-4" />Transferir</Button>
            <Button onClick={() => setAdjust({ item: "", location: "central", client: "", work: CANTEIRO, delta: "", note: "" })}><SlidersHorizontal className="mr-1 h-4 w-4" />Ajustar estoque</Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {LOCATIONS.map((l) => (
          <button key={l.key} onClick={() => setF({ ...f, location: f.location === l.key ? ALL : l.key })}
            className={`panel p-3 text-left transition hover:bg-muted/40 ${f.location === l.key ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{l.label}</div>
            <div className="font-display text-2xl font-semibold">{totals(l.key).toLocaleString("pt-BR")}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Cliente" value={f.client} onChange={(v) => setF({ ...f, client: v, work: ALL })} options={(clients.data ?? []).map((c: any) => [c.id, c.name])} />
        <Filter label="Serviço" value={f.work} onChange={(v) => setF({ ...f, work: v })} options={[[CANTEIRO, "Canteiro"], ...worksOf(f.client).map((w: any) => [w.id, w.name])]} />
        <Filter label="Item" value={f.item} onChange={(v) => setF({ ...f, item: v })} options={(items.data ?? []).map((i: any) => [i.id, i.name])} />
        <Filter label="Categoria" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={categories.map((c) => [c, c])} />
        <Filter label="Localização" value={f.location} onChange={(v) => setF({ ...f, location: v })} options={LOCATIONS.map((l) => [l.key, l.label])} />
        <Button variant="ghost" size="sm" onClick={() => setF({ client: ALL, work: ALL, item: ALL, category: ALL, location: ALL })}>Limpar filtros</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              {cols.map((l) => <TableHead key={l.key} className="text-right">{l.label}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.map((r) => (
              <TableRow key={r.item.id}>
                <TableCell className="font-medium">{r.item.name}<span className="ml-2 text-xs text-muted-foreground">{r.item.code}</span></TableCell>
                {cols.map((l) => <TableCell key={l.key} className="text-right">{(r.by[l.key] ?? 0).toLocaleString("pt-BR")}</TableCell>)}
                <TableCell className={`text-right font-semibold ${r.item.min_stock > 0 && (r.by["central"] ?? 0) < r.item.min_stock ? "text-destructive" : ""}`}>{r.total.toLocaleString("pt-BR")}</TableCell>
                <TableCell><Button size="icon" variant="ghost" title="Movimentações" onClick={() => setMoves(r.item)}><History className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
            {!table.length && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Nenhum material encontrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!newItem} onOpenChange={(o) => !o && setNewItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo material</DialogTitle></DialogHeader>
          {newItem && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código" v={newItem.code} on={(v) => setNewItem({ ...newItem, code: v })} />
              <Field label="Nome" v={newItem.name} on={(v) => setNewItem({ ...newItem, name: v })} />
              <Field label="Categoria" v={newItem.category} on={(v) => setNewItem({ ...newItem, category: v })} />
              <Field label="Unidade" v={newItem.unit} on={(v) => setNewItem({ ...newItem, unit: v })} />
              <Field label="Estoque mínimo" v={newItem.min_stock} on={(v) => setNewItem({ ...newItem, min_stock: v })} type="number" />
            </div>
          )}
          <DialogFooter><Button onClick={async () => {
            if (!newItem.name.trim()) { toast.error("Informe o nome"); return; }
            const { error } = await supabase.from("andam_items").insert({ code: newItem.code || null, name: newItem.name.trim(), category: newItem.category || null, unit: newItem.unit || "un", min_stock: Number(newItem.min_stock) || 0 });
            if (error) { toast.error(error.message); return; }
            setNewItem(null); refresh(); toast.success("Material cadastrado");
          }}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar estoque</DialogTitle></DialogHeader>
          {adjust && (
            <div className="space-y-3">
              <Pick label="Material" value={adjust.item} onChange={(v) => setAdjust({ ...adjust, item: v })} options={(items.data ?? []).map((i: any) => [i.id, i.name])} />
              <Place loc={adjust.location} client={adjust.client} work={adjust.work} clients={clients.data ?? []} works={works.data ?? []}
                onChange={(p) => setAdjust({ ...adjust, location: p.loc, client: p.client, work: p.work })} />
              <Field label="Quantidade (use negativo para retirar)" v={adjust.delta} on={(v) => setAdjust({ ...adjust, delta: v })} type="number" />
              <Field label="Observação" v={adjust.note} on={(v) => setAdjust({ ...adjust, note: v })} />
            </div>
          )}
          <DialogFooter><Button onClick={async () => {
            const a = adjust; const d = Number(a.delta);
            if (!a.item || !d) { toast.error("Informe material e quantidade"); return; }
            if (a.location === "obra" && !a.client) { toast.error("Informe o cliente"); return; }
            const { error } = await supabase.rpc("andam_adjust", { _item: a.item, _location: a.location, _client: a.location === "obra" ? a.client : null, _work: a.location === "obra" && a.work !== CANTEIRO ? a.work : null, _delta: d, _note: a.note || null } as any);
            if (error) { toast.error(error.message); return; }
            setAdjust(null); refresh(); toast.success("Estoque ajustado");
          }}>Confirmar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!transfer} onOpenChange={(o) => !o && setTransfer(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferir</DialogTitle></DialogHeader>
          {transfer && (
            <div className="space-y-3">
              <Pick label="Material" value={transfer.item} onChange={(v) => setTransfer({ ...transfer, item: v })} options={(items.data ?? []).map((i: any) => [i.id, i.name])} />
              <div className="text-sm font-medium">Origem</div>
              <Place loc={transfer.from} client={transfer.fromClient} work={transfer.fromWork} clients={clients.data ?? []} works={works.data ?? []}
                onChange={(p) => setTransfer({ ...transfer, from: p.loc, fromClient: p.client, fromWork: p.work })} />
              <div className="text-sm font-medium">Destino</div>
              <Place loc={transfer.to} client={transfer.toClient} work={transfer.toWork} clients={clients.data ?? []} works={works.data ?? []}
                onChange={(p) => setTransfer({ ...transfer, to: p.loc, toClient: p.client, toWork: p.work })} />
              <Field label="Quantidade" v={transfer.qty} on={(v) => setTransfer({ ...transfer, qty: v })} type="number" />
              <Field label="Observação" v={transfer.note} on={(v) => setTransfer({ ...transfer, note: v })} />
            </div>
          )}
          <DialogFooter><Button onClick={async () => {
            const t = transfer; const q = Number(t.qty);
            if (!t.item || !(q > 0)) { toast.error("Informe material e quantidade"); return; }
            if ((t.from === "obra" && !t.fromClient) || (t.to === "obra" && !t.toClient)) { toast.error("Informe o cliente"); return; }
            const side = (loc: string, c: string, w: string) => [loc === "obra" ? c : null, loc === "obra" && w !== CANTEIRO ? w : null];
            const [fc, fw] = side(t.from, t.fromClient, t.fromWork); const [tc, tw] = side(t.to, t.toClient, t.toWork);
            const { error } = await supabase.rpc("andam_transfer", { _item: t.item, _from_loc: t.from, _from_client: fc, _from_work: fw, _to_loc: t.to, _to_client: tc, _to_work: tw, _qty: q, _note: t.note || null } as any);
            if (error) { toast.error(error.message); return; }
            setTransfer(null); refresh(); toast.success("Transferência registrada");
          }}>Confirmar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <MovesDialog item={moves} onClose={() => setMoves(null)} clients={clients.data ?? []} works={works.data ?? []} />
    </div>
  );
}

function MovesDialog({ item, onClose, clients, works }: { item: any; onClose: () => void; clients: any[]; works: any[] }) {
  const q = useQuery({
    queryKey: ["andam-moves", item?.id], enabled: !!item,
    queryFn: async () => (await supabase.from("andam_movements").select("*").eq("item_id", item.id).order("created_at", { ascending: false }).limit(200)).data ?? [],
  });
  const place = (loc: string | null, c: string | null, w: string | null) => !loc ? "—" : loc !== "obra" ? locLabel(loc)
    : `${clients.find((x) => x.id === c)?.name ?? "Obra"} · ${w ? works.find((x) => x.id === w)?.name ?? "" : "Canteiro"}`;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Movimentações — {item?.name}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Origem</TableHead><TableHead>Destino</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead>Obs.</TableHead></TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{new Date(m.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>{m.kind === "ajuste_inventario" ? "Inventário" : m.kind === "transferencia" ? "Transferência" : "Ajuste"}</TableCell>
                  <TableCell>{place(m.from_location, m.from_client_id, m.from_work_id)}</TableCell>
                  <TableCell>{place(m.to_location, m.to_client_id, m.to_work_id)}</TableCell>
                  <TableCell className="text-right">{Number(m.quantity).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.notes}</TableCell>
                </TableRow>
              ))}
              {!q.data?.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sem movimentações.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Place({ loc, client, work, clients, works, onChange }: { loc: string; client: string; work: string; clients: any[]; works: any[]; onChange: (p: { loc: string; client: string; work: string }) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Pick label="Local" value={loc} onChange={(v) => onChange({ loc: v, client, work })} options={LOCATIONS.map((l) => [l.key, l.label])} />
      {loc === "obra" && <>
        <Pick label="Cliente" value={client} onChange={(v) => onChange({ loc, client: v, work: CANTEIRO })} options={clients.map((c) => [c.id, c.name])} />
        <Pick label="Serviço" value={work} onChange={(v) => onChange({ loc, client, work: v })} options={[[CANTEIRO, "Canteiro"], ...works.filter((w) => w.client_id === client).map((w) => [w.id, w.name])]} />
      </>}
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>Todos</SelectItem>{options.map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
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
function Field({ label, v, on, type }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label>{label}</Label><Input type={type} value={v} onChange={(e) => on(e.target.value)} /></div>;
}

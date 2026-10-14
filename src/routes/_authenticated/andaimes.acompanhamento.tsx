import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Plus, Trash2, AlertTriangle, Paperclip, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

function DocField({ kind, label, ro, number, path, onNumber, onPath }: {
  kind: "project" | "art"; label: string; ro: boolean; number: string; path: string | null;
  onNumber: (v: string) => void; onPath: (p: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const p = `${kind}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("andam-docs").upload(p, file, { contentType: file.type });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onPath(p); toast.success("Arquivo anexado");
  };
  const openFile = async () => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("andam-docs").createSignedUrl(path, 600);
    if (error || !data) { toast.error(error?.message ?? "Erro"); return; }
    window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="space-y-1">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <Input disabled={ro} value={number} onChange={(e) => onNumber(e.target.value)} />
        <label className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${ro ? "opacity-50" : "cursor-pointer hover:bg-accent"} ${path ? "text-primary" : "text-muted-foreground"}`} title={path ? "Substituir arquivo" : "Anexar arquivo"}>
          <Paperclip className="h-4 w-4" />
          <input type="file" className="hidden" disabled={ro || busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </label>
      </div>
      {path && (
        <div className="flex items-center gap-1 text-xs">
          <button type="button" className="truncate text-primary underline" onClick={openFile}>{path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "")}</button>
          {!ro && <button type="button" onClick={() => onPath(null)} title="Remover"><X className="h-3 w-3" /></button>}
        </div>
      )}
    </div>
  );
}
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useAndamScope } from "@/hooks/use-andam-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STRUCT_STATUS, inspectionState } from "@/lib/andaimes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Apontamentos, MonthProductivity, Produtividade, RdoFilters, useRdoFilters } from "@/components/scaffold-rdo-reports";

export const Route = createFileRoute("/_authenticated/andaimes/acompanhamento")({
  head: () => ({
    meta: [
      { title: "Acompanhamento de Andaimes | AB5 Hub" },
      { name: "description", content: "Montagem, liberação, vistorias e desmontagem dos andaimes nas obras." },
      { property: "og:title", content: "Acompanhamento de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Ciclo dos andaimes montados nas obras." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const fmtDate = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const today = () => new Date().toISOString().slice(0, 10);
const sel = "h-9 rounded-md border bg-background px-2 text-sm";

function Page() {
  const { clients, works, canEdit, isAdmin } = useAndamScope();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fClient, setFClient] = useState("");
  const [fStatus, setFStatus] = useState("");
  const list = useQuery({
    queryKey: ["andam-struct"],
    queryFn: async () => (await supabase.from("andam_structures").select("*, clients(name), works(name)").order("created_at", { ascending: false })).data ?? [],
  });
  const rows = (list.data ?? []).filter((r: any) => (!fClient || r.client_id === fClient) && (!fStatus || r.status === fStatus));
  const active = (list.data ?? []).filter((r: any) => r.status !== "desmontado");
  const cards = [
    ["Em montagem", active.filter((r: any) => r.status === "montagem").length],
    ["Liberados", active.filter((r: any) => r.status === "liberado").length],
    ["Vistoria a vencer", active.filter((r: any) => inspectionState(r.inspection_valid_until, today()) === "expiring").length],
    ["Vistoria vencida", active.filter((r: any) => inspectionState(r.inspection_valid_until, today()) === "expired").length],
    ["Aguardando desmontagem", active.filter((r: any) => r.status === "aguardando_desmontagem").length],
  ] as const;
  const remove = async (r: any) => {
    if (!confirm("Excluir este andaime do acompanhamento?")) return;
    const { error } = await supabase.from("andam_structures").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["andam-struct"] });
  };
  const rf = useRdoFilters();
  return (
    <div className="space-y-4">
      <PageHeader title="Acompanhamento" description="Andaimes montados nas obras, apontamentos e produtividade a partir dos RDOs." />
      <Tabs defaultValue="andaimes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="andaimes">Andaimes</TabsTrigger>
          <TabsTrigger value="apontamentos">Apontamentos</TabsTrigger>
          <TabsTrigger value="produtividade">Produtividade</TabsTrigger>
        </TabsList>
        <TabsContent value="apontamentos" className="space-y-4"><RdoFilters f={rf} /><Apontamentos workId={rf.wid} start={rf.start} end={rf.end} ym={rf.ym} /></TabsContent>
        <TabsContent value="produtividade" className="space-y-4"><RdoFilters f={rf} extra={<MonthProductivity workId={rf.wid} start={rf.start} end={rf.end} />} /><Produtividade workId={rf.wid} start={rf.start} end={rf.end} /></TabsContent>
        <TabsContent value="andaimes" className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Novo andaime</Button></div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {cards.map(([l, n]) => (
          <div key={l} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{n}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={sel} value={fClient} onChange={(e) => setFClient(e.target.value)}>
          <option value="">Todos os clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={sel} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos os status</option>{Object.entries(STRUCT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Ordem</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço</TableHead><TableHead>Local</TableHead><TableHead>Montagem</TableHead><TableHead>Vistoria até</TableHead><TableHead>Status</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => {
              const st = r.status === "desmontado" ? "ok" : inspectionState(r.inspection_valid_until, today());
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.order_code || "—"}</TableCell>
                  <TableCell>{r.clients?.name}</TableCell>
                  <TableCell>{r.works?.name ?? "Canteiro"}</TableCell>
                  <TableCell>{r.location_desc || "—"}</TableCell>
                  <TableCell>{fmtDate(r.assembled_at)}</TableCell>
                  <TableCell className={st === "expired" ? "text-destructive font-medium" : st === "expiring" ? "text-amber-600 font-medium" : ""}>
                    {st !== "ok" && st !== "none" && <AlertTriangle className="mr-1 inline h-3 w-3" />}{fmtDate(r.inspection_valid_until)}
                  </TableCell>
                  <TableCell><Badge variant={r.status === "liberado" ? "default" : "secondary"}>{STRUCT_STATUS[r.status]}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {canEdit && (r.status === "montagem" || isAdmin) && <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                    <Button size="icon" variant="ghost" title="Ver detalhes" onClick={() => setOpen(r.id)}><Eye className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Nenhum andaime.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
        </TabsContent>
      </Tabs>
      {(open || creating) && (
        <StructDialog id={open} clients={clients} works={works} canEdit={canEdit}
          onClose={() => { setOpen(null); setCreating(false); qc.invalidateQueries({ queryKey: ["andam-struct"] }); }} />
      )}
    </div>
  );
}

function StructDialog({ id, clients, works, canEdit, onClose }: { id: string | null; clients: any[]; works: any[]; canEdit: boolean; onClose: () => void }) {
  const loaded = useQuery({
    queryKey: ["andam-struct-one", id],
    enabled: !!id,
    queryFn: async () => {
      const h = (await supabase.from("andam_structures").select("*").eq("id", id!).single()).data;
      const it = (await supabase.from("andam_structure_items").select("item_id, quantity").eq("structure_id", id!)).data ?? [];
      return { h, it };
    },
  });
  const items = useQuery({ queryKey: ["andam-items-active"], queryFn: async () => (await supabase.from("andam_items").select("id, name, unit").eq("active", true).order("name")).data ?? [] });
  const [f, setF] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  if (id && !loaded.data) return null;
  const form = f ?? (id ? loaded.data!.h : { client_id: "", work_id: "", status: "montagem", assembled_at: today() });
  if (!f) setTimeout(() => {
    setF(form);
    if (id) setQty(Object.fromEntries(loaded.data!.it.map((x: any) => [x.item_id, String(x.quantity)])));
  });
  const set = (k: string, v: any) => setF({ ...form, [k]: v });
  const save = async () => {
    if (!form.client_id) { toast.error("Selecione o cliente"); return; }
    const payload = {
      client_id: form.client_id, work_id: form.work_id || null, order_code: form.order_code || null, location_desc: form.location_desc || null,
      status: form.status, assembled_at: form.assembled_at || null, released_at: form.released_at || null,
      inspection_valid_until: form.inspection_valid_until || null, dismantled_at: form.dismantled_at || null,
      responsible: form.responsible || null, notes: form.notes || null,
      has_project_art: !!form.has_project_art,
      project_number: form.project_number || null, project_file_path: form.project_file_path || null,
      art_number: form.art_number || null, art_file_path: form.art_file_path || null,
    };
    let sid = id;
    if (id) {
      const { error } = await supabase.from("andam_structures").update(payload).eq("id", id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("andam_structures").insert(payload).select("id").single();
      if (error) { toast.error(error.message); return; }
      sid = data.id;
    }
    await supabase.from("andam_structure_items").delete().eq("structure_id", sid!);
    const lines = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([item_id, q]) => ({ structure_id: sid!, item_id, quantity: Number(q) }));
    if (lines.length) {
      const { error } = await supabase.from("andam_structure_items").insert(lines);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Salvo"); onClose();
  };
  const ws = works.filter((w) => w.client_id === form.client_id);
  const ro = !canEdit;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{id ? "Andaime" : "Novo andaime"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">Cliente
            <select disabled={ro} className={`${sel} w-full`} value={form.client_id ?? ""} onChange={(e) => setF({ ...form, client_id: e.target.value, work_id: "" })}>
              <option value="">Selecione</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="space-y-1">Serviço
            <select disabled={ro} className={`${sel} w-full`} value={form.work_id ?? ""} onChange={(e) => set("work_id", e.target.value)}>
              <option value="">Canteiro</option>{ws.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label className="space-y-1">Ordem<Input disabled={ro} placeholder="ORDEM xxxxxxxx" value={form.order_code ?? ""} onChange={(e) => set("order_code", e.target.value)} /></label>
          <label className="space-y-1">Local na obra<Input disabled={ro} value={form.location_desc ?? ""} onChange={(e) => set("location_desc", e.target.value)} /></label>
          <label className="space-y-1">Status
            <select disabled={ro} className={`${sel} w-full`} value={form.status} onChange={(e) => {
              const s = e.target.value; const p: any = { ...form, status: s };
              if (s === "liberado" && !form.released_at) p.released_at = today();
              if (s === "desmontado" && !form.dismantled_at) p.dismantled_at = today();
              setF(p);
            }}>{Object.entries(STRUCT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="space-y-1">Responsável<Input disabled={ro} value={form.responsible ?? ""} onChange={(e) => set("responsible", e.target.value)} /></label>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <Switch disabled={ro} checked={!!form.has_project_art} onCheckedChange={(v) => set("has_project_art", v)} />
            <span>Projeto/ART</span>
          </div>
          {form.has_project_art && (["project", "art"] as const).map((k) => (
            <DocField key={k} kind={k} label={k === "project" ? "Nº do Projeto" : "Nº da ART"} ro={ro}
              number={form[`${k}_number`] ?? ""} path={form[`${k}_file_path`] ?? null}
              onNumber={(v) => set(`${k}_number`, v)}
              onPath={(p) => setF((cur: any) => ({ ...(cur ?? form), [`${k}_file_path`]: p }))} />
          ))}
          <label className="space-y-1">Montagem<Input disabled={ro} type="date" value={form.assembled_at ?? ""} onChange={(e) => set("assembled_at", e.target.value)} /></label>
          <label className="space-y-1">Liberação<Input disabled={ro} type="date" value={form.released_at ?? ""} onChange={(e) => set("released_at", e.target.value)} /></label>
          <label className="space-y-1">Vistoria válida até<Input disabled={ro} type="date" value={form.inspection_valid_until ?? ""} onChange={(e) => set("inspection_valid_until", e.target.value)} /></label>
          <label className="space-y-1">Desmontagem<Input disabled={ro} type="date" value={form.dismantled_at ?? ""} onChange={(e) => set("dismantled_at", e.target.value)} /></label>
          <label className="col-span-2 space-y-1">Observações<Input disabled={ro} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <div className="mt-2 text-sm font-medium">Peças aplicadas</div>
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Material</TableHead><TableHead className="w-32">Quantidade</TableHead></TableRow></TableHeader>
            <TableBody>
              {(items.data ?? []).map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell>{i.name} <span className="text-xs text-muted-foreground">({i.unit})</span></TableCell>
                  <TableCell><Input disabled={ro} type="number" min={0} className="h-8" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">As peças aplicadas são só de controle; o saldo da obra continua no Estoque e volta ao Pátio pelo romaneio de retorno.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {canEdit && <Button onClick={save}>Salvar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

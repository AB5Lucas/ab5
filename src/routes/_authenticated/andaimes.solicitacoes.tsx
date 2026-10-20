import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Eye, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useAndamScope } from "@/hooks/use-andam-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FLOW, PRIORITY, flowPendingFor, flowStep, notReturned, romNumber, shortage } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/solicitacoes")({
  head: () => ({
    meta: [
      { title: "Solicitações de Andaimes | AB5 Hub" },
      { name: "description", content: "Fluxo único de andaimes: solicitação, aprovações, separação, romaneios e retorno ao pátio." },
      { property: "og:title", content: "Solicitações de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Solicitação, aprovações, romaneios e retorno ao pátio em um só fluxo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const CANTEIRO = "__canteiro";
const ALL = "__all";
const fmtDate = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const fmtDT = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const num = (v: any) => Number(v ?? 0).toLocaleString("pt-BR");
const RET = [["ret_bom", "Bom"], ["ret_danificado", "Danificado"], ["ret_quebrado", "Quebrado"], ["ret_inutilizado", "Inutilizado"], ["ret_manutencao", "Manutenção"]] as const;
const ACTION_LABEL: Record<string, string> = {
  aprovar_solicitacao: "Aprovou a solicitação", concluir_separacao: "Concluiu a separação", devolver_separacao: "Devolveu para separação",
  aprovar_saida: "Aprovou a saída (romaneio gerado)", receber_obra: "Confirmou o recebimento na obra", gerar_retorno: "Gerou o romaneio de retorno",
  receber_patio: "Confirmou o recebimento no pátio", encerrar: "Encerrou a solicitação", cancelar: "Cancelou a solicitação",
};
const stageLabel = (s: string) => (s === "cancelada" ? "Cancelada" : flowStep(s)?.label ?? s);

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

/** Responsáveis do fluxo (coordenador de andaimes e encarregado do pátio) e nomes de usuários */
function useFlowPeople() {
  return useQuery({
    queryKey: ["andam-flow-people"],
    queryFn: async () => {
      const [{ data: roles }, { data: people }] = await Promise.all([
        supabase.from("andam_flow_roles").select("key, user_id"),
        supabase.from("users_profiles").select("id, full_name"),
      ]);
      const ids: Record<string, string> = {};
      (roles ?? []).forEach((r) => (ids[r.key] = r.user_id));
      const names = new Map((people ?? []).map((p) => [p.id, p.full_name || "—"]));
      return { coordenador: ids["coordenador"], patio: ids["patio"], names };
    },
  });
}

function Page() {
  const { clients, works, user, isAdmin, canEdit } = useAndamScope();
  const qc = useQueryClient();
  const people = useFlowPeople();
  const [tab, setTab] = useState("aprovacoes");
  const [fClient, setFClient] = useState(ALL);
  const [fStage, setFStage] = useState(ALL);
  const [form, setForm] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["andam-req"],
    queryFn: async () => (await supabase.from("andam_requests").select("*, clients(name), works(name)").order("number", { ascending: false })).data ?? [],
  });
  const rows = list.data ?? [];
  const p = people.data;
  const pendingId = (r: any) => flowPendingFor(r.flow_stage, { coordenador: p?.coordenador, patio: p?.patio, solicitante: r.user_id });
  const mine = (r: any) => !!user && (pendingId(r) === user.id || (isAdmin && !!flowStep(r.flow_stage)?.actor));
  const filtered = useMemo(() => rows.filter((r: any) => {
    if (tab === "aprovacoes" && !mine(r)) return false;
    if (tab === "andamento" && ["encerrada", "cancelada"].includes(r.flow_stage)) return false;
    if (fClient !== ALL && r.client_id !== fClient) return false;
    if (fStage !== ALL && r.flow_stage !== fStage) return false;
    return true;
  }), [rows, tab, fClient, fStage, p, user?.id, isAdmin]);
  const myCount = rows.filter(mine).length;

  const remove = async (r: any) => {
    if (!confirm(`Excluir a solicitação nº ${r.number}?`)) return;
    const { error } = await supabase.from("andam_requests").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Solicitação excluída"); qc.invalidateQueries({ queryKey: ["andam-req"] });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações" description="Fluxo único: solicitação, aprovações, separação, romaneio de saída, obra e retorno ao pátio."
        actions={canEdit ? <Button onClick={() => setForm({ client: "", work: CANTEIRO, request_date: new Date().toISOString().slice(0, 10), needed_date: "", priority: "normal", notes: "", lines: [{ item: "", qty: "" }] })}><Plus className="mr-1 h-4 w-4" />Nova solicitação</Button> : undefined} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="aprovacoes">Aprovações{myCount ? ` (${myCount})` : ""}</TabsTrigger>
          <TabsTrigger value="andamento">Em andamento</TabsTrigger>
          <TabsTrigger value="todas">Todas</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {FLOW.filter((s) => s.actor).map((s) => (
          <Card key={s.key} className={`cursor-pointer transition-colors ${fStage === s.key ? "border-primary" : ""}`} onClick={() => setFStage(fStage === s.key ? ALL : s.key)}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold">{rows.filter((r: any) => r.flow_stage === s.key).length}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Filter value={fClient} onChange={setFClient} placeholder="Todos os clientes" options={clients.map((c) => [c.id, c.name])} />
        <Filter value={fStage} onChange={setFStage} placeholder="Todas as etapas" options={[...FLOW.map((s) => [s.key, s.label]), ["cancelada", "Cancelada"]]} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço</TableHead><TableHead>Solicitante</TableHead><TableHead>Necessária em</TableHead><TableHead>Prioridade</TableHead><TableHead>Etapa</TableHead><TableHead>Aguardando</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {filtered.map((r: any) => {
              const who = pendingId(r);
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                  <TableCell>{r.number}</TableCell>
                  <TableCell>{r.clients?.name}</TableCell>
                  <TableCell>{r.works?.name ?? "Canteiro"}</TableCell>
                  <TableCell>{p?.names.get(r.user_id) ?? "—"}</TableCell>
                  <TableCell>{fmtDate(r.needed_date)}</TableCell>
                  <TableCell><Badge variant={r.priority === "urgente" ? "destructive" : "outline"}>{PRIORITY[r.priority]}</Badge></TableCell>
                  <TableCell><Badge variant={r.flow_stage === "encerrada" ? "default" : r.flow_stage === "cancelada" ? "outline" : "secondary"}>{stageLabel(r.flow_stage)}</Badge></TableCell>
                  <TableCell className={who && who === user?.id ? "font-semibold text-primary" : ""}>{who ? (who === user?.id ? "Você" : p?.names.get(who) ?? "Responsável não definido") : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" title="Ver detalhes" onClick={() => setOpen(r.id)}><Eye className="h-4 w-4" /></Button>
                    {isAdmin && <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </TableCell>
                </TableRow>
              );
            })}
            {!filtered.length && <TableRow><TableCell colSpan={9} className="text-muted-foreground">{tab === "aprovacoes" ? "Nada aguardando você." : "Nenhuma solicitação."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {form && <NewDialog form={form} setForm={setForm} clients={clients} works={works} userId={user?.id} onDone={(id: string) => { setForm(null); qc.invalidateQueries({ queryKey: ["andam-req"] }); setOpen(id); }} />}
      {open && <RequestDialog id={open} userId={user?.id} isAdmin={isAdmin} people={p} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["andam-req"] }); }} />}
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
    const { data: req, error } = await supabase.from("andam_requests").insert({
      client_id: form.client, work_id: form.work !== CANTEIRO ? form.work : null, request_date: form.request_date,
      needed_date: form.needed_date || null, priority: form.priority, notes: form.notes || null, user_id: userId ?? null,
      status: "aberta",
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
          <Pick label="Serviço" value={form.work} onChange={(v) => setForm({ ...form, work: v })} options={[[CANTEIRO, "Canteiro"], ...works.filter((w: any) => w.client_id === form.client).map((w: any) => [w.id, w.name])]} />
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

function RequestDialog({ id, userId, isAdmin, people, onClose }: { id: string; userId?: string | undefined; isAdmin: boolean; people: any; onClose: () => void }) {
  const qc = useQueryClient();
  const central = useCentral();
  const [busy, setBusy] = useState(false);
  const head = useQuery({ queryKey: ["andam-req-one", id], queryFn: async () => (await supabase.from("andam_requests").select("*, clients(name), works(name)").eq("id", id).single()).data });
  const lines = useQuery({ queryKey: ["andam-req-items", id], queryFn: async () => (await supabase.from("andam_request_items").select("*, andam_items(name, unit)").eq("request_id", id)).data ?? [] });
  const roms = useQuery({ queryKey: ["andam-req-roms", id], queryFn: async () => (await supabase.from("andam_romaneios").select("*, andam_romaneio_items(*, andam_items(name, unit))").eq("request_id", id).order("number")).data ?? [] });
  const events = useQuery({ queryKey: ["andam-req-events", id], queryFn: async () => (await supabase.from("andam_request_events").select("*").eq("request_id", id).order("created_at")).data ?? [] });
  const h: any = head.data;
  const refresh = () => {
    ["andam-req-one", "andam-req-items", "andam-req-roms", "andam-req-events"].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }));
    ["andam-req", "andam-stock", "andam-central"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  if (!h) return null;
  const stage = h.flow_stage as string;
  const step = flowStep(stage);
  const pending = flowPendingFor(stage, { coordenador: people?.coordenador, patio: people?.patio, solicitante: h.user_id });
  const canAct = !!step?.actor && (pending === userId || isAdmin);
  const name = (u?: string | null) => (u ? people?.names.get(u) ?? "—" : "Responsável não definido");
  const avail = (it: string) => central.data?.get(it) ?? 0;
  const sorted = [...(lines.data ?? [])].sort((a: any, b: any) => a.andam_items.name.localeCompare(b.andam_items.name, "pt-BR"));
  const editSep = canAct && stage === "em_separacao";
  const editRet = canAct && (stage === "em_obra" || stage === "aguardando_recebimento_patio");
  const showRet = ["em_obra", "aguardando_recebimento_patio", "aguardando_encerramento", "encerrada"].includes(stage);
  const idx = FLOW.findIndex((s) => s.key === stage);

  const setQty = async (line: string, field: string, qty: number) => {
    const { error } = await supabase.rpc("andam_flow_set_qty", { _line: line, _field: field, _qty: qty });
    if (error) toast.error(error.message); refresh();
  };
  const advance = async (action: string, ask: string) => {
    if (!confirm(ask)) return;
    setBusy(true);
    const { error } = await supabase.rpc("andam_flow_advance", { _req: id, _action: action });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(ACTION_LABEL[action] ?? "Etapa concluída"); refresh();
  };
  const ASK: Record<string, string> = {
    aprovar_solicitacao: "Aprovar a solicitação e liberar para separação no pátio?",
    concluir_separacao: "Concluir a separação e enviar para aprovação da saída?",
    aprovar_saida: "Aprovar a saída? Será gerado o romaneio e o material sai do estoque central para trânsito.",
    receber_obra: "Confirmar que o material chegou na obra?",
    gerar_retorno: "Gerar o romaneio de retorno com as quantidades informadas e enviar ao pátio?",
    receber_patio: "Confirmar o recebimento no pátio? Bons voltam ao estoque; danificados/quebrados/inutilizados vão para Danificados; manutenção para Em manutenção. A diferença permanece na obra.",
    encerrar: "Aprovar e encerrar a solicitação?",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-auto">
        <DialogHeader><DialogTitle>Solicitação nº {h.number} — {h.clients?.name} · {h.works?.name ?? "Canteiro"}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">
          Solicitante {name(h.user_id)} · Solicitada em {fmtDate(h.request_date)} · Necessária em {fmtDate(h.needed_date)} · Prioridade {PRIORITY[h.priority]}
          {h.notes && <div>Obs.: {h.notes}</div>}
        </div>

        <div className="flex flex-wrap gap-1">
          {FLOW.map((s, i) => {
            const done = stage === "encerrada" || (idx >= 0 && i < idx);
            const cur = s.key === stage;
            const who = s.actor === "coordenador" ? people?.coordenador : s.actor === "patio" ? people?.patio : s.actor === "solicitante" ? h.user_id : null;
            return (
              <div key={s.key} className={`min-w-[120px] flex-1 rounded-md border px-2 py-1.5 text-xs ${cur ? "border-primary bg-primary/10" : done ? "bg-muted" : ""}`}>
                <div className="flex items-center gap-1 font-medium">{done && <Check className="h-3 w-3 text-primary" />}{i + 1}. {s.label}</div>
                {s.actor && <div className="text-muted-foreground">{name(who)}</div>}
              </div>
            );
          })}
        </div>
        {stage === "cancelada" && <div className="text-sm font-medium text-destructive">Solicitação cancelada.</div>}
        {step?.actor && <div className="text-sm">Etapa atual: <b>{step.label}</b> — aguardando <b>{pending === userId ? "você" : name(pending)}</b>.</div>}

        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Material</TableHead><TableHead className="text-right">Solicitado</TableHead><TableHead className="text-right">Disponível</TableHead><TableHead className="w-28 text-right">Separado</TableHead><TableHead className="text-right">Falta</TableHead></TableRow></TableHeader>
            <TableBody>
              {sorted.map((l: any) => {
                const f = Math.max(0, Number(l.requested_qty) - Number(l.separated_qty));
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.andam_items.name} <span className="text-xs text-muted-foreground">{l.andam_items.unit}</span></TableCell>
                    <TableCell className="text-right">{num(l.requested_qty)}</TableCell>
                    <TableCell className="text-right">{num(avail(l.item_id))}</TableCell>
                    <TableCell className="text-right">
                      {editSep
                        ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l.separated_qty} onBlur={(e) => Number(e.target.value) !== Number(l.separated_qty) && setQty(l.id, "separated_qty", Number(e.target.value || 0))} />
                        : num(l.separated_qty)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${f > 0 ? "text-destructive" : ""}`}>{num(f)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {(roms.data ?? []).map((ro: any) => {
          const its = [...(ro.andam_romaneio_items ?? [])].sort((a: any, b: any) => a.andam_items.name.localeCompare(b.andam_items.name, "pt-BR"));
          const missing = its.reduce((a: number, l: any) => a + notReturned(l.sent_qty, RET.map(([k]) => l[k])), 0);
          return (
            <div key={ro.id} className="space-y-1">
              <div className="text-sm font-medium">
                Romaneio {romNumber(ro.number)}
                <span className="font-normal text-muted-foreground">
                  {ro.sent_at && ` · Saída ${fmtDT(ro.sent_at)}`}{ro.received_at && ` · Na obra ${fmtDT(ro.received_at)}`}{ro.returned_at && ` · Retorno ao pátio ${fmtDT(ro.returned_at)}`}
                </span>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Saiu</TableHead>{showRet && RET.map(([k, l]) => <TableHead key={k} className="w-24 text-right">{l}</TableHead>)}{showRet && <TableHead className="text-right">Diferença</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {its.map((l: any) => {
                      const miss = notReturned(l.sent_qty, RET.map(([k]) => l[k]));
                      return (
                        <TableRow key={l.id}>
                          <TableCell>{l.andam_items.name}</TableCell>
                          <TableCell className="text-right">{num(l.sent_qty)}</TableCell>
                          {showRet && RET.map(([k]) => (
                            <TableCell key={k} className="text-right">
                              {editRet && ro.status === "recebido"
                                ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l[k]} onBlur={(e) => Number(e.target.value) !== Number(l[k]) && setQty(l.id, k, Number(e.target.value || 0))} />
                                : num(l[k])}
                            </TableCell>
                          ))}
                          {showRet && <TableCell className={`text-right font-medium ${miss > 0 ? "text-destructive" : ""}`}>{miss > 0 ? `-${num(miss)}` : "0"}</TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {showRet && missing > 0 && <div className="text-xs font-medium text-destructive">{num(missing)} unidades sem retorno — permanecem registradas na obra.</div>}
            </div>
          );
        })}

        {!!events.data?.length && (
          <div className="space-y-1 text-xs">
            <div className="text-sm font-medium">Histórico</div>
            {events.data.map((e: any) => <div key={e.id} className="text-muted-foreground">{fmtDT(e.created_at)} · {name(e.user_id)} · {ACTION_LABEL[e.action] ?? e.action}</div>)}
          </div>
        )}

        {canAct && step?.action && (
          <DialogFooter className="flex-wrap gap-2">
            {["aguardando_aprovacao", "em_separacao", "aguardando_aprovacao_saida"].includes(stage) && (pending === people?.coordenador || isAdmin) && userId !== h.user_id &&
              <Button variant="ghost" disabled={busy} onClick={() => advance("cancelar", "Cancelar esta solicitação?")}>Cancelar solicitação</Button>}
            {stage === "aguardando_aprovacao_saida" && <Button variant="outline" disabled={busy} onClick={() => advance("devolver_separacao", "Devolver para o pátio revisar a separação?")}>Devolver para separação</Button>}
            <Button disabled={busy} onClick={() => advance(step.action!, ASK[step.action!] ?? "Confirmar?")}>{step.button}</Button>
          </DialogFooter>
        )}
        {!canAct && h.user_id === userId && ["aguardando_aprovacao", "em_separacao", "aguardando_aprovacao_saida"].includes(stage) && (
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => advance("cancelar", "Cancelar esta solicitação?")}>Cancelar solicitação</Button></DialogFooter>
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

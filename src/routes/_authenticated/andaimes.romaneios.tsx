import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useAndamScope } from "@/hooks/use-andam-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROM_STATUS, notReturned, romNumber } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/romaneios")({
  head: () => ({
    meta: [
      { title: "Romaneios de Andaimes | AB5 Hub" },
      { name: "description", content: "Controle físico de saída, recebimento e retorno dos materiais de andaime." },
      { property: "og:title", content: "Romaneios de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Saída, recebimento na obra e retorno com divergências." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const fmtDate = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const RET = [["ret_bom", "Bom"], ["ret_danificado", "Danificado"], ["ret_quebrado", "Quebrado"], ["ret_inutilizado", "Inutilizado"], ["ret_manutencao", "Manutenção"]] as const;

function Page() {
  const { canEdit } = useAndamScope();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["andam-rom"],
    queryFn: async () => (await supabase.from("andam_romaneios").select("*, clients(name), works(name), andam_requests(number)").order("number", { ascending: false })).data ?? [],
  });
  const remove = async (r: any) => {
    if (!confirm(`Excluir o romaneio ${romNumber(r.number)}?`)) return;
    const { error } = await supabase.from("andam_romaneios").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Romaneio excluído"); qc.invalidateQueries({ queryKey: ["andam-rom"] });
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Romaneios" description="Controle físico de saída e retorno dos materiais. Gere romaneios a partir de uma solicitação separada." />
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço / Canteiro</TableHead><TableHead>Solicitação</TableHead><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{romNumber(r.number)}</TableCell>
                <TableCell>{r.clients?.name}</TableCell>
                <TableCell>{r.works?.name ?? "Canteiro"}</TableCell>
                <TableCell>{r.andam_requests?.number ?? "—"}</TableCell>
                <TableCell>{fmtDate(r.romaneio_date)}</TableCell>
                <TableCell><Badge variant={r.status === "retornado" ? "default" : r.status === "em_transito" ? "outline" : "secondary"}>{ROM_STATUS[r.status]}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button size="icon" variant="ghost" title="Ver detalhes" onClick={() => setOpen(r.id)}><Eye className="h-4 w-4" /></Button>
                  {canEdit && ["rascunho", "cancelado"].includes(r.status) && <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {!list.data?.length && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhum romaneio.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {open && <RomDialog id={open} canEdit={canEdit} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["andam-rom"] }); }} />}
    </div>
  );
}

function RomDialog({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const head = useQuery({ queryKey: ["andam-rom-one", id], queryFn: async () => (await supabase.from("andam_romaneios").select("*, clients(name), works(name), andam_requests(number)").eq("id", id).single()).data });
  const lines = useQuery({ queryKey: ["andam-rom-items", id], queryFn: async () => (await supabase.from("andam_romaneio_items").select("*, andam_items(name, unit)").eq("romaneio_id", id)).data ?? [] });
  const h: any = head.data;
  if (!h) return null;
  const refresh = () => { ["andam-rom-one", "andam-rom-items"].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] })); qc.invalidateQueries({ queryKey: ["andam-rom"] }); qc.invalidateQueries({ queryKey: ["andam-stock"] }); qc.invalidateQueries({ queryKey: ["andam-central"] }); qc.invalidateQueries({ queryKey: ["andam-req"] }); };
  const sorted = [...(lines.data ?? [])].sort((a: any, b: any) => a.andam_items.name.localeCompare(b.andam_items.name, "pt-BR"));
  const upd = async (lid: string, patch: any) => { const { error } = await supabase.from("andam_romaneio_items").update(patch).eq("id", lid); if (error) toast.error(error.message); refresh(); };
  const rpc = async (fn: "andam_romaneio_send" | "andam_romaneio_receive" | "andam_romaneio_return", msg: string, ask: string) => {
    if (!confirm(ask)) return;
    const { error } = await supabase.rpc(fn, { _rom: id });
    if (error) { toast.error(error.message); return; }
    toast.success(msg); refresh();
  };
  const draft = h.status === "rascunho";
  const returning = h.status === "recebido";
  const showReturn = returning || h.status === "retornado";
  const missingTotal = sorted.reduce((a: number, l: any) => a + notReturned(l.sent_qty, RET.map(([k]) => l[k])), 0);
  const num = (v: any) => Number(v).toLocaleString("pt-BR");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{romNumber(h.number)} — {h.clients?.name} · {h.works?.name ?? "Canteiro"}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">
          {fmtDate(h.romaneio_date)}{h.andam_requests?.number ? ` · Solicitação nº ${h.andam_requests.number}` : ""} · <b>{ROM_STATUS[h.status]}</b>
          {h.sent_at && <> · Saída {new Date(h.sent_at).toLocaleString("pt-BR")}</>}
          {h.received_at && <> · Recebido {new Date(h.received_at).toLocaleString("pt-BR")}</>}
          {h.returned_at && <> · Retorno {new Date(h.returned_at).toLocaleString("pt-BR")}</>}
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Item</TableHead>
                {!showReturn && <><TableHead className="text-right">Solicitado</TableHead><TableHead className="text-right">Separado</TableHead></>}
                <TableHead className="w-28 text-right">{showReturn ? "Saiu" : "Enviado"}</TableHead>
                {showReturn && RET.map(([k, l]) => <TableHead key={k} className="w-24 text-right">{l}</TableHead>)}
                {showReturn && <TableHead className="text-right">Diferença</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((l: any) => {
                const miss = notReturned(l.sent_qty, RET.map(([k]) => l[k]));
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.andam_items.name} <span className="text-xs text-muted-foreground">{l.andam_items.unit}</span></TableCell>
                    {!showReturn && <><TableCell className="text-right">{num(l.requested_qty)}</TableCell><TableCell className="text-right">{num(l.separated_qty)}</TableCell></>}
                    <TableCell className="text-right">
                      {canEdit && draft
                        ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l.sent_qty} onBlur={(e) => Number(e.target.value) !== Number(l.sent_qty) && upd(l.id, { sent_qty: Number(e.target.value || 0) })} />
                        : num(l.sent_qty)}
                    </TableCell>
                    {showReturn && RET.map(([k]) => (
                      <TableCell key={k} className="text-right">
                        {canEdit && returning
                          ? <Input type="number" min={0} className="h-8 text-right" defaultValue={l[k]} onBlur={(e) => Number(e.target.value) !== Number(l[k]) && upd(l.id, { [k]: Number(e.target.value || 0) })} />
                          : num(l[k])}
                      </TableCell>
                    ))}
                    {showReturn && <TableCell className={`text-right font-medium ${miss > 0 ? "text-destructive" : ""}`}>{miss > 0 ? `-${num(miss)}` : "0"}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {showReturn && missingTotal > 0 && <div className="text-sm font-medium text-destructive">{num(missingTotal)} unidades não retornadas{h.status === "retornado" ? " — permanecem registradas na obra" : ""}</div>}
        {canEdit && (draft || h.status === "em_transito" || returning) && (
          <DialogFooter>
            {draft && <Button onClick={() => rpc("andam_romaneio_send", "Saída confirmada", "Confirmar a saída? As quantidades enviadas sairão do estoque central e ficarão em trânsito.")}>Confirmar saída</Button>}
            {h.status === "em_transito" && <Button onClick={() => rpc("andam_romaneio_receive", "Recebimento confirmado", "Confirmar o recebimento do material na obra?")}>Confirmar recebimento</Button>}
            {returning && <Button onClick={() => rpc("andam_romaneio_return", "Retorno registrado", "Registrar o retorno? Bons voltam ao estoque central; danificados/quebrados/inutilizados vão para Danificados; manutenção para Em manutenção. A diferença permanece na obra.")}>Registrar retorno</Button>}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

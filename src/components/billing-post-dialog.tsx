import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/search-select";

type Note = { id: string; invoice_number: string; client_name: string; amount: number; issued_at: string | null; order_number: string | null; quote_number: string | null };
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR") : "—");
const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Nota pendente → escolher cliente e serviço: o banco cria o pedido no serviço com os dados da nota
 * (nº do pedido, senão orçamento, senão "NFSe <nº>"; valor e data da nota) e lança o faturamento
 * (billing_note_post_to_work, migração 0189).
 */
export function BillingPostDialog({ note, onClose, onDone }: { note: Note | null; onClose: () => void; onDone: () => void }) {
  const [clientId, setClientId] = useState("");
  const [workId, setWorkId] = useState("");
  const [saving, setSaving] = useState(false);
  const clients = useQuery({ queryKey: ["billing-post", "clients"], enabled: !!note, staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.from("clients").select("id, name").order("name"); if (error) throw error; return data ?? []; } });
  const works = useQuery({ queryKey: ["billing-post", "works", clientId], enabled: !!clientId,
    queryFn: async () => { const { data, error } = await supabase.from("works").select("id, name, status, active").eq("client_id", clientId).order("name"); if (error) throw error; return data ?? []; } });
  // Já abre no cliente com o mesmo nome da nota, quando há só um.
  useEffect(() => {
    setWorkId("");
    if (!note || !clients.data) { setClientId(""); return; }
    const k = key(note.client_name ?? "");
    const hit = clients.data.filter((c) => key(c.name) === k || (k.length >= 4 && (key(c.name).includes(k) || k.includes(key(c.name)))));
    setClientId(hit.length === 1 ? hit[0]!.id : "");
  }, [note?.id, clients.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWorkId(""); }, [clientId]);
  const workOpts = useMemo(() => (works.data ?? [])
    .sort((a, b) => Number(b.active && !["completed", "cancelled"].includes(b.status ?? "")) - Number(a.active && !["completed", "cancelled"].includes(a.status ?? "")) || a.name.localeCompare(b.name, "pt-BR"))
    .map((w) => ({ value: w.id, label: w.active && !["completed", "cancelled"].includes(w.status ?? "") ? w.name : `${w.name} (inativo)` })), [works.data]);
  const orderNum = note ? (note.order_number?.trim() || note.quote_number?.trim() || `NFSe ${note.invoice_number}`) : "";

  async function confirm() {
    if (!note || !workId) return;
    setSaving(true);
    const { error } = await (supabase.rpc as any)("billing_note_post_to_work", { _note: note.id, _work: workId });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`NFSe ${note.invoice_number} lançada no serviço`);
    onDone(); onClose();
  }
  return <Dialog open={!!note} onOpenChange={(v) => { if (!v) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Lançar no serviço · NFSe {note?.invoice_number}</DialogTitle>
        <DialogDescription>{note?.client_name} · {note ? brl(note.amount) : ""} · emissão {fmt(note?.issued_at ?? null)}</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1"><Label htmlFor="post-client" className="block">Cliente</Label>
          <SearchSelect id="post-client" value={clientId} onChange={setClientId} options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder={clients.isLoading ? "Carregando…" : "Escolha o cliente"} /></div>
        <div className="space-y-1"><Label htmlFor="post-work" className="block">Serviço</Label>
          <SearchSelect id="post-work" value={workId} onChange={setWorkId} options={workOpts} disabled={!clientId} placeholder={!clientId ? "Escolha o cliente primeiro" : works.isLoading ? "Carregando…" : "Escolha o serviço"} /></div>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Será criado no serviço o pedido <span className="font-medium text-foreground">{orderNum}</span> de <span className="font-medium text-foreground">{note ? brl(note.amount) : ""}</span> com data {fmt(note?.issued_at ?? null)} (se o serviço já tiver esse pedido, ele é mantido) e a nota será lançada como faturamento.
        </div>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={confirm} disabled={!workId || saving}>{saving ? "Lançando…" : "Criar pedido e lançar"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Note = { id: string; invoice_number: string; client_name: string; amount: number };
type Entry = { id: string; description: string | null; amount: number; entry_date: string; sync_note_id: string | null; works: { name: string; client: string } | null };
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR");

export function BillingReplaceDialog({ note, onClose, onDone }: { note: Note | null; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const entries = useQuery({
    queryKey: ["billing-replace-entries", note?.id], enabled: !!note,
    queryFn: async () => {
      const { data, error } = await supabase.from("work_entries").select("id, description, amount, entry_date, sync_note_id, works(name, client)").eq("category", "faturamento").eq("sync_cancelled", false).order("entry_date", { ascending: false }).limit(2000);
      if (error) throw error; return (data ?? []) as unknown as Entry[];
    },
  });
  const sameValue = useMemo(() => (entries.data ?? []).filter(e => note && Math.abs(Number(e.amount) - Number(note.amount)) < 0.01), [entries.data, note]);
  useEffect(() => { setSearch(""); setSelected(null); }, [note?.id]);
  useEffect(() => { if (!selected && sameValue[0]) setSelected(sameValue[0].id); }, [sameValue, selected]);
  const list = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const base = q ? (entries.data ?? []).filter(e => `${e.description ?? ""} ${e.works?.client ?? ""} ${e.works?.name ?? ""} ${e.amount}`.toLocaleLowerCase("pt-BR").includes(q)) : sameValue;
    return base.slice(0, 100);
  }, [entries.data, sameValue, search]);
  async function confirm() {
    if (!note || !selected) return;
    setSaving(true);
    const { error } = await supabase.rpc("billing_note_replace", { _note: note.id, _entry: selected });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`NFSe ${note.invoice_number} substituiu o lançamento anterior`);
    onDone(); onClose();
  }
  return <Dialog open={!!note} onOpenChange={v => { if (!v) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Substituir lançamento · NFSe {note?.invoice_number}</DialogTitle>
        <DialogDescription>{note?.client_name} · {note ? brl(note.amount) : ""}. O lançamento escolhido passa a ser desta nota; o anterior deixa de contar.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label htmlFor="replace-search">Buscar outro lançamento</Label>
        <Input id="replace-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pedido, cliente, serviço ou valor" /></div>
      <p className="text-xs text-muted-foreground">{search ? "Resultados da busca" : "Lançamentos com o mesmo valor"}</p>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {entries.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
        {!entries.isLoading && !list.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lançamento encontrado</p>}
        {list.map(e => <label key={e.id} className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm ${selected === e.id ? "border-primary bg-accent" : "border-border"}`}>
          <input type="radio" name="replace-entry" checked={selected === e.id} onChange={() => setSelected(e.id)} />
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{e.description || "Sem descrição"}</p><p className="truncate text-xs text-muted-foreground">{e.works?.client} · {e.works?.name} · {fmt(e.entry_date)}</p></div>
          <span className="whitespace-nowrap tabular-nums">{brl(e.amount)}</span>
        </label>)}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={confirm} disabled={!selected || saving}>{saving ? "Substituindo…" : "Substituir"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Repeat2, Pencil, Square, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Recurrence = Database['public']['Tables']['work_entry_recurrences']['Row'];
const categories = [{ key: 'mao_obra', label: 'Mão de obra' }, { key: 'terceiros', label: 'Transporte' }, { key: 'materiais', label: 'Materiais' }, { key: 'ferramentas', label: 'Ferramentas' }, { key: 'andaimes', label: 'Andaimes' }];
export function ResultRecurrences({ workIds, seed, clearSeed, onChanged }: { workIds: string[]; seed: any; clearSeed: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const [form, setForm] = useState({ category: 'andaimes', description: '', amount: '', start: '', end: '', active: true });
  const rules = useQuery({ queryKey: ['result-recurrences', workIds], queryFn: async () => {
    const result = await supabase.from('work_entry_recurrences').select('*').in('work_id', workIds).order('start_month');
    if (result.error) throw result.error;
    return result.data;
  }});
  const changed = async () => { await Promise.all(['result-recurrences', 'work-result', 'fin-client-raw'].map(key => qc.invalidateQueries({ queryKey: [key] }))); onChanged(); clearSeed(); setEditing(null); };
  const save = useMutation({ mutationFn: async () => {
    const source = seed ?? editing;
    if (!source) throw new Error('Selecione um lançamento');
    const values = { work_id: source.work_id, category: form.category, description: form.description.trim(), amount: Number(form.amount.replace(',', '.')), start_month: `${form.start}-01`, end_month: form.end ? `${form.end}-01` : null, active: form.active };
    if (!(values.amount > 0) || !form.start || (form.end && form.end < form.start)) throw new Error('Confira valor e meses');
    const result = editing ? await supabase.from('work_entry_recurrences').update(values).eq('id', editing.id) : await supabase.from('work_entry_recurrences').insert(values);
    if (result.error) throw result.error;
    const generated = await supabase.rpc('generate_recurring_entries', { _work_ids: [source.work_id] });
    if (generated.error) throw generated.error;
  }, onSuccess: changed, onError: (e) => toast.error(e.message) });
  const end = useMutation({ mutationFn: async (r: Recurrence) => {
    if (!window.confirm(`Encerrar a recorrência “${r.description}”? Os lançamentos existentes serão mantidos.`)) return;
    const result = await supabase.from('work_entry_recurrences').update({ active: false, end_month: new Date().toISOString().slice(0, 7) + '-01' }).eq('id', r.id);
    if (result.error) throw result.error;
  }, onSuccess: changed, onError: (e) => toast.error(e.message) });
  // Seed is keyed by the parent so a new entry always opens a fresh form.
  const openEditor = (r: Recurrence) => { clearSeed(); setEditing(r); setForm({ category: r.category, description: r.description, amount: String(r.amount), start: r.start_month.slice(0, 7), end: r.end_month?.slice(0, 7) ?? '', active: r.active }); };
  const [initialized, setInitialized] = useState(false);
  if (seed && !initialized) { setInitialized(true); setForm({ category: seed.category, description: seed.description ?? '', amount: String(seed.amount), start: seed.entry_date.slice(0, 7), end: '', active: true }); }
  return <section className="space-y-3 border-t border-border pt-3">
    <h3 className="flex items-center gap-2 font-semibold"><Repeat2 className="size-4" />Recorrências mensais</h3>
    {(seed || editing) && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="space-y-1"><Label>Categoria</Label><Select value={form.category} onValueChange={category => setForm({ ...form, category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="col-span-2 space-y-1"><Label htmlFor="rec-description">Descrição</Label><Input id="rec-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="rec-amount">Valor mensal</Label><Input id="rec-amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="rec-start">Mês inicial</Label><Input id="rec-start" type="month" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="rec-end">Mês final (opcional)</Label><Input id="rec-end" type="month" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></div>
      <label className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={active => setForm({ ...form, active })} />Ativa</label>
      <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" size="icon" title="Cancelar recorrência" aria-label="Cancelar recorrência" onClick={() => { clearSeed(); setEditing(null); }}><X className="size-4" /></Button><Button disabled={save.isPending} onClick={() => save.mutate()}><Check className="size-4" />Salvar recorrência</Button></div>
    </div>}
    {rules.isPending ? <p>Carregando...</p> : rules.isError ? <p className="text-destructive">Não foi possível carregar as recorrências.</p> : !rules.data?.length ? <p className="text-sm text-muted-foreground">Nenhuma recorrência cadastrada.</p> : rules.data.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm"><div><p className="font-medium">{r.description} · {Number(r.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p><p className="text-muted-foreground">{categories.find(c => c.key === r.category)?.label} · {r.start_month.slice(0, 7)} até {r.end_month?.slice(0, 7) ?? 'sem fim'} · {r.active ? 'Ativa' : 'Encerrada'}</p></div><div className="flex"><Button variant="ghost" size="icon" title="Editar recorrência" aria-label="Editar recorrência" onClick={() => openEditor(r)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title="Encerrar recorrência" aria-label="Encerrar recorrência" disabled={!r.active || end.isPending} onClick={() => end.mutate(r)}><Square className="size-4" /></Button></div></div>)}
  </section>;
}
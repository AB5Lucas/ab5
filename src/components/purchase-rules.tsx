import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reprocessPurchasesNow } from "@/lib/purchases.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PurchaseRules({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("code");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const qc = useQueryClient();
  const reprocess = useServerFn(reprocessPurchasesNow);
  const data = useQuery({ queryKey: ["purchase-rules"], queryFn: async () => {
    const [rules, redirects] = await Promise.all([supabase.from("purchase_exclusion_rules").select("*").order("value"), supabase.from("purchase_cc_redirects").select("*").order("source_cc")]);
    if (rules.error) throw rules.error;
    if (redirects.error) throw redirects.error;
    return { rules: rules.data, redirects: redirects.data };
  } });
  async function mutate(action: () => PromiseLike<{ error: unknown }>) {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      const r = await action();
      if (r.error) throw r.error;
      await reprocess();
      await Promise.all([qc.invalidateQueries({ queryKey: ["purchase-rules"] }), qc.invalidateQueries({ queryKey: ["purchase-lines"] })]);
      toast.success("Regras aplicadas e compras recalculadas");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível aplicar a regra"); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Settings2 className="h-4 w-4" /> Regras</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Regras de Compras</DialogTitle></DialogHeader>
      <h3 className="font-semibold">Exclusões</h3>
      <div className="space-y-2">{data.data?.rules.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <Switch aria-label={`Ativar exclusão ${r.value}`} disabled={!canWrite || busy} checked={r.active} onCheckedChange={(active) => mutate(() => supabase.from("purchase_exclusion_rules").update({ active }).eq("id", r.id))} />
        <span className="w-28 font-mono text-xs">{r.value}{r.match_type === "prefix" ? "*" : ""}</span>
        <Input aria-label={`Motivo ${r.value}`} className="min-w-48 flex-1" defaultValue={r.reason} disabled={!canWrite || busy} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== r.reason) mutate(() => supabase.from("purchase_exclusion_rules").update({ reason: e.target.value.trim() }).eq("id", r.id)); }} />
        {canWrite && <Button variant="ghost" size="icon" aria-label={`Excluir regra ${r.value}`} disabled={busy} onClick={() => mutate(() => supabase.from("purchase_exclusion_rules").delete().eq("id", r.id))}><Trash2 className="h-4 w-4" /></Button>}
      </div>)}</div>
      {canWrite && <div className="flex flex-wrap items-end gap-2"><div className="space-y-1"><Label>Regra</Label><Select value={type} onValueChange={setType}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="code">Código</SelectItem><SelectItem value="prefix">Prefixo</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label>Código</Label><Input className="w-32" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div><div className="min-w-40 flex-1 space-y-1"><Label>Motivo</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div><Button size="icon" aria-label="Adicionar exclusão" disabled={busy || !code.trim() || !reason.trim()} onClick={() => mutate(() => supabase.from("purchase_exclusion_rules").insert({ match_type: type, value: code.trim(), reason: reason.trim() }))}><Plus className="h-4 w-4" /></Button></div>}
      <h3 className="mt-3 font-semibold">Redirecionamentos de centro de custo</h3>
      {data.data?.redirects.map((r) => <div key={r.id} className="flex items-center gap-2"><Switch aria-label={`Ativar redirecionamento ${r.source_cc}`} disabled={!canWrite || busy} checked={r.active} onCheckedChange={(active) => mutate(() => supabase.from("purchase_cc_redirects").update({ active }).eq("id", r.id))} /><span className="font-mono text-sm">{r.source_cc} → {r.target_cc}</span>{canWrite && <Button variant="ghost" size="icon" aria-label={`Excluir redirecionamento ${r.source_cc}`} disabled={busy} onClick={() => mutate(() => supabase.from("purchase_cc_redirects").delete().eq("id", r.id))}><Trash2 className="h-4 w-4" /></Button>}</div>)}
      {canWrite && <div className="flex flex-wrap items-end gap-2"><div className="space-y-1"><Label>CC origem</Label><Input value={source} onChange={(e) => setSource(e.target.value.replace(/\D/g, ""))} /></div><div className="space-y-1"><Label>CC destino</Label><Input value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} /></div><Button size="icon" aria-label="Adicionar redirecionamento" disabled={busy || !source || !target || source === target} onClick={() => mutate(() => supabase.from("purchase_cc_redirects").upsert({ source_cc: source, target_cc: target }, { onConflict: "source_cc" }))}><Plus className="h-4 w-4" /></Button></div>}
      {busy && <p className="text-sm text-muted-foreground">Recalculando compras…</p>}
    </DialogContent></Dialog>
  </>;
}
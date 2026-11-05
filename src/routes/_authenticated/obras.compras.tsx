import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CornerDownRight, Filter, RefreshCw, Landmark } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { directPurchase, syncPurchasesNow, reprocessPurchasesNow, savePurchaseAsset } from "@/lib/purchases.functions";
import { PurchaseRules } from "@/components/purchase-rules";
import { useCurrentUser } from "@/hooks/use-auth";
import { assetCategory, installmentPlan, normalizePurchaseText, type PurchaseItemState } from "@/lib/purchase-policy";
import { PURCHASE_CATEGORIES, isIndustryClient, purchaseCategory, type CcItem, type PurchaseCategory } from "@/lib/purchases";

export const Route = createFileRoute("/_authenticated/obras/compras")({
  head: () => ({
    meta: [
      { title: "Compras | AB5 Hub" },
      { name: "description", content: "Despesas de compras por centro de custo lançadas nos serviços." },
      { property: "og:title", content: "Compras | AB5 Hub" },
      { property: "og:description", content: "Despesas de compras por centro de custo lançadas nos serviços." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComprasPage,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ALL = "__all";

const CAT_LABEL = Object.fromEntries(PURCHASE_CATEGORIES.map((c) => [c.key, c.label])) as Record<PurchaseCategory, string>;

type Line = { id: string; ref_month: string; cc_code: string; cc_name: string | null; amount: number; status: string; reason: string | null; target_client_id: string | null; target_work_id: string | null; items: unknown; excluded_amount: number; pending_amount: number; launched_amount: number; effective_cc: string | null; item_states: unknown };

function ComprasPage() {
  const qc = useQueryClient();
  const sync = useServerFn(syncPurchasesNow);
  const direct = useServerFn(directPurchase);
  const reprocess = useServerFn(reprocessPurchasesNow);
  const saveAsset = useServerFn(savePurchaseAsset);
  const { canWrite } = useCurrentUser();
  const [asset, setAsset] = useState<{ line: Line; item: CcItem; state: PurchaseItemState } | null>(null);
  const [assetMode, setAssetMode] = useState<"pending" | "integral" | "installments">("installments");
  const [assetMonths, setAssetMonths] = useState(12);
  const [assetMonthly, setAssetMonthly] = useState(0);
  const [assetCat, setAssetCat] = useState("materiais");
  const [assetIsAsset, setAssetIsAsset] = useState(false);
  const [assetClient, setAssetClient] = useState(ALL);
  const [assetWork, setAssetWork] = useState(ALL);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Line | null>(null);
  const [selClient, setSelClient] = useState<string>("");
  const [selWork, setSelWork] = useState<string>(ALL);

  const data = useQuery({
    queryKey: ["purchase-lines"],
    queryFn: async () => {
      const [l, c, w, decisions] = await Promise.all([
        supabase.from("purchase_cc_lines").select("*").order("ref_month", { ascending: false }).order("cc_code"),
        supabase.from("clients").select("id, name, cc_prefix").order("name"),
        supabase.from("works").select("id, name, client_id, active").order("name"),
        supabase.from("purchase_asset_decisions").select("*"),
      ]);
      if (l.error) throw l.error;
      if (c.error) throw c.error;
      if (w.error) throw w.error;
      if (decisions.error) throw decisions.error;
      const ids = l.data.map((x) => x.id);
      const entries: { purchase_cc_id: string | null; purchase_item_key: string | null; work_id: string; amount: number }[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        for (let page = 0; ; page++) {
          const { data: e, error } = await supabase.from("work_entries").select("purchase_cc_id, purchase_item_key, work_id, amount").in("purchase_cc_id", ids.slice(i, i + 200)).order("id").range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          entries.push(...(e ?? []));
          if (!e || e.length < 1000) break;
        }
      }
      return { lines: l.data as Line[], clients: c.data, works: w.data, entries, decisions: decisions.data };
    },
  });

  const d = data.data;
  const workName = useMemo(() => {
    const cn = new Map((d?.clients ?? []).map((c) => [c.id, c.name]));
    return new Map((d?.works ?? []).map((w) => [w.id, `${cn.get(w.client_id ?? "") ?? "—"} · ${w.name}`]));
  }, [d]);
  const months = useMemo(() => [...new Set((d?.lines ?? []).map((l) => l.ref_month))], [d]);
  const items = useMemo(() => {
    const s = normalizePurchaseText(q);
    const out: { line: Line; code: string; desc: string; qty: number; amount: number; date: string | null; cat: PurchaseCategory; state: PurchaseItemState }[] = [];
    for (const l of d?.lines ?? []) {
      if (month !== ALL && l.ref_month !== month) continue;
      for (const [index, it] of ((Array.isArray(l.items) ? l.items : []) as CcItem[]).entries()) {
        const state = ((l.item_states ?? []) as PurchaseItemState[]).find((s) => s.index === index) ?? { key: "", index, asset: false, status: l.status === "pending" ? "pending" : "launched", reason: l.reason, category: null, excluded: 0, pending: 0, launched: 0 } as PurchaseItemState;
        if (status !== ALL && state.status !== status) continue;
        const date = it.date ?? null;
        const ref = date ?? `${l.ref_month}-01`;
        if (from && ref < from) continue;
        if (to && (date ?? `${l.ref_month}-01`) > to) continue;
        const targetWork = d?.works.find((w) => w.id === l.target_work_id);
        const clientId = targetWork?.client_id ?? l.target_client_id;
        const client = clientId ? d?.clients.find((c) => c.id === clientId) : d?.clients.find((c) => c.cc_prefix === (l.effective_cc ?? l.cc_code).slice(0, 4));
        const cat = (state.category ?? purchaseCategory(it.code, isIndustryClient(client?.name))) as PurchaseCategory;
        if (hiddenCats.has(cat)) continue;
        if (s && !normalizePurchaseText(`${it.code} ${it.desc} ${l.cc_code} ${l.cc_name ?? ""}`).includes(s)) continue;
        out.push({ line: l, code: it.code, desc: it.desc, qty: Number(it.qty ?? 0), amount: Number(it.amount ?? 0), date, cat, state });
      }
    }
    return out.sort((a, b) => (b.date ?? b.line.ref_month).localeCompare(a.date ?? a.line.ref_month) || a.line.cc_code.localeCompare(b.line.cc_code));
  }, [d, month, status, q, from, to, hiddenCats]);
  const totals = useMemo(() => {
    const base = (d?.lines ?? []).filter((l) => month === ALL || l.ref_month === month);
    const sum = (key: "amount" | "launched_amount" | "pending_amount" | "excluded_amount") => base.reduce((a, l) => a + Number(l[key]), 0);
    return { all: sum("amount"), launched: sum("launched_amount"), pending: sum("pending_amount"), excluded: sum("excluded_amount"), pendingCount: base.flatMap((l) => (l.item_states ?? []) as PurchaseItemState[]).filter((s) => s.status === "pending").length };
  }, [d, month]);

  async function runSync() {
    setBusy(true);
    try {
      const r = await sync();
      const p = r.reduce((a, x) => a + x.pending, 0), l = r.reduce((a, x) => a + x.launched, 0);
      toast.success(`Sincronizado: ${l} centros lançados, ${p} pendentes`);
      qc.invalidateQueries({ queryKey: ["purchase-lines"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na sincronização"); }
    finally { setBusy(false); }
  }

  async function runReprocess() {
    setBusy(true);
    try { await reprocess(); await qc.invalidateQueries({ queryKey: ["purchase-lines"] }); toast.success("Compras reprocessadas"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao reprocessar"); }
    finally { setBusy(false); }
  }
  function openAsset(line: Line, item: CcItem, state: PurchaseItemState) {
    const saved = d?.decisions.find((x) => x.purchase_cc_id === line.id && x.item_key === state.key);
    setAsset({ line, item, state }); setAssetMode(saved?.mode ?? (state.asset ? "installments" : "integral")); setAssetMonths(saved?.months ?? 12); setAssetMonthly(saved?.monthly_amount ?? Math.round(item.amount * 100 / 12) / 100); setAssetCat(saved?.category ?? state.category ?? assetCategory(item));
    setAssetIsAsset(saved?.is_asset ?? state.asset); setAssetClient(saved?.target_client_id ?? ALL); setAssetWork(saved?.target_work_id ?? ALL);
  }
  async function decideAsset() {
    if (!asset || busy) return;
    setBusy(true);
    try { await saveAsset({ data: { line_id: asset.line.id, item_key: asset.state.key, is_asset: assetIsAsset, mode: assetMode, months: assetMonths, monthly_amount: assetMonthly, category: assetCat, target_client_id: assetClient === ALL ? null : assetClient, target_work_id: assetWork === ALL ? null : assetWork } }); await qc.invalidateQueries({ queryKey: ["purchase-lines"] }); setAsset(null); toast.success("Decisão salva e lançamentos atualizados"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar decisão"); }
    finally { setBusy(false); }
  }
  let preview: ReturnType<typeof installmentPlan> = [];
  let previewError = "";
  if (asset && assetMode === "installments") { try { preview = installmentPlan(asset.item.amount, asset.line.ref_month, assetMonths, assetMonthly); } catch (e) { previewError = e instanceof Error ? e.message : "Parcelas inválidas"; } }

  function openDirect(l: Line) {
    setEditing(l);
    setSelClient(l.target_client_id ?? "");
    setSelWork(l.target_work_id ?? ALL);
  }
  async function saveDirect() {
    if (!editing || !selClient) return;
    try {
      const st = await direct({ data: { id: editing.id, client_id: selClient, work_id: selWork === ALL ? null : selWork } });
      toast[st === "launched" ? "success" : "warning"](st === "launched" ? "Compra lançada" : "Destino salvo; ainda há itens pendentes de decisão ou destino.");
      if (st === "launched") setEditing(null);
      qc.invalidateQueries({ queryKey: ["purchase-lines"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao direcionar"); }
  }

  const clientWorks = (d?.works ?? []).filter((w) => w.client_id === selClient);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Compras"
        description="Despesas da planilha de Compras (pasta Compras/RELATÓRIOS) lançadas nos serviços pelo centro de custo."
        actions={<div className="flex flex-wrap gap-2"><PurchaseRules canWrite={canWrite} />{canWrite && <><Button variant="outline" size="sm" onClick={runReprocess} disabled={busy}>Reprocessar</Button><Button size="sm" onClick={runSync} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sincronizar</Button></>}</div>}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Total de compras</p><p className="text-lg font-semibold">{brl(totals.all)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Lançado nos serviços</p><p className="text-lg font-semibold">{brl(totals.launched)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Pendente ({totals.pendingCount})</p><p className="text-lg font-semibold">{brl(totals.pending)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Excluídos</p><p className="text-lg font-semibold">{brl(totals.excluded)}</p></div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>Mês</Label>
          <Select value={month} onValueChange={setMonth}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todos</SelectItem>{months.map((m) => <SelectItem key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Início</Label><Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label>Fim</Label><Input type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="space-y-1"><Label>Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todos</SelectItem><SelectItem value="launched">Lançados</SelectItem><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="excluded">Excluídos</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label>Categorias</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline"><Filter className="h-4 w-4" /> {hiddenCats.size > 0 ? `${PURCHASE_CATEGORIES.length - hiddenCats.size} selecionadas` : "Todas"}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-60">
              <p className="mb-2 text-xs text-muted-foreground">Marque as categorias exibidas.</p>
              <div className="space-y-2">
                {PURCHASE_CATEGORIES.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!hiddenCats.has(c.key)} onCheckedChange={(v) => setHiddenCats((s) => { const n = new Set(s); if (v) n.delete(c.key); else n.add(c.key); return n; })} />
                    {c.key === "andaimes" ? "Insumos / Andaimes" : c.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover></div>
        <div className="space-y-1"><Label>Busca</Label><Input className="w-64" placeholder="Item, código ou centro de custo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <p className="text-sm text-muted-foreground">{items.length} itens · {brl(items.reduce((a, i) => a + i.amount, 0))}</p>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Data</TableHead><TableHead>Centro de custo</TableHead><TableHead>Item</TableHead><TableHead>Categoria</TableHead>
            <TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Valor</TableHead>
            <TableHead>Status</TableHead><TableHead>Lançado em</TableHead><TableHead className="w-12" />
          </TableRow></TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
            {!data.isLoading && !items.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Nenhum item. Clique em Sincronizar.</TableCell></TableRow>}
            {items.map((it, idx) => {
              const l = it.line;
              const parts = [...new Map((d?.entries ?? []).filter((e) => e.purchase_cc_id === l.id && e.purchase_item_key === it.state.key).map((e) => [e.work_id, e])).values()];
              return (
                <TableRow key={`${l.id}-${idx}`}>
                  <TableCell className="whitespace-nowrap">{it.date ? it.date.split("-").reverse().join("/") : `${l.ref_month.slice(5)}/${l.ref_month.slice(0, 4)}`}</TableCell>
                  <TableCell><span className="font-mono text-xs">{l.cc_code}</span> <span className="text-xs text-muted-foreground">{l.cc_name}</span>{l.effective_cc && l.effective_cc !== l.cc_code && <div className="text-xs text-primary">Redirecionado → {l.effective_cc}</div>}</TableCell>
                  <TableCell><span className="font-mono text-xs">{it.code}</span> <span className="text-sm">{it.desc}</span></TableCell>
                  <TableCell className="text-xs">{it.cat === "andaimes" ? "Insumos" : CAT_LABEL[it.cat]}</TableCell>
                  <TableCell className="text-right">{it.qty.toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{brl(it.amount)}</TableCell>
                  <TableCell><Badge variant={it.state.status === "pending" ? "destructive" : "secondary"}>{it.state.status === "excluded" ? "Excluído" : it.state.status === "pending" ? "Pendente" : "Lançado"}</Badge>{it.state.reason && <p className="mt-1 text-xs text-muted-foreground">{it.state.reason}</p>}{it.state.asset && <p className="text-xs">Ativo</p>}</TableCell>
                  <TableCell className="text-xs">
                    {it.state.status === "launched" && parts.length ? parts.map((p, i) => <div key={i}>{workName.get(p.work_id) ?? "—"}</div>) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{canWrite && <div className="flex"><Button size="icon" variant="ghost" title="Direcionar centro de custo" onClick={() => openDirect(l)}><CornerDownRight className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Decidir lançamento do item" aria-label="Decidir lançamento do item" onClick={() => openAsset(l, { code: it.code, desc: it.desc, qty: it.qty, amount: it.amount, date: it.date }, it.state)}><Landmark className="h-4 w-4" /></Button></div>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!asset} onOpenChange={(o) => !o && setAsset(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Decisão do item · {asset?.item.code}</DialogTitle></DialogHeader>
        <p className="text-sm">{asset?.item.desc} · {asset ? brl(asset.item.amount) : ""}</p>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={assetIsAsset} onCheckedChange={(v) => setAssetIsAsset(v === true)} />Ativo</label>
        <div className="space-y-1"><Label>Cliente de destino</Label><Select value={assetClient} onValueChange={(v) => { setAssetClient(v); setAssetWork(ALL); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Manter destino do centro de custo</SelectItem>{(d?.clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Serviço de destino</Label><Select value={assetWork} onValueChange={setAssetWork} disabled={assetClient === ALL}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Ratear por horas entre serviços</SelectItem>{(d?.works ?? []).filter((w) => w.client_id === assetClient).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.active ? "" : " (inativo)"}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Lançamento</Label><Select value={assetMode} onValueChange={(v) => setAssetMode(v as typeof assetMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Manter pendente de decisão</SelectItem><SelectItem value="integral">Integral no mês da compra</SelectItem><SelectItem value="installments">Ratear em parcelas mensais</SelectItem></SelectContent></Select></div>
        {assetMode === "installments" && <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>Meses</Label><Input aria-label="Meses do ativo" type="number" min={1} max={120} value={assetMonths} onChange={(e) => { const n = Number(e.target.value); setAssetMonths(n); setAssetMonthly(asset && n > 0 ? Math.round(asset.item.amount * 100 / n) / 100 : 0); }} /></div><div className="space-y-1"><Label>Valor mensal</Label><Input aria-label="Valor mensal do ativo" type="number" step="0.01" value={assetMonthly} onChange={(e) => setAssetMonthly(Number(e.target.value))} /></div></div>}
        <div className="space-y-1"><Label>Categoria</Label><Select value={assetCat} onValueChange={setAssetCat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PURCHASE_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.key === "andaimes" ? "Insumos / Andaimes" : c.label}</SelectItem>)}</SelectContent></Select></div>
        {previewError ? <p className="text-sm text-destructive">{previewError}</p> : preview.length > 0 && <div className="max-h-40 overflow-auto text-sm">{preview.map((p) => <div key={p.month} className="flex justify-between"><span>{p.month.slice(5)}/{p.month.slice(0, 4)}</span><span>{brl(p.amount)}</span></div>)}</div>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAsset(null)}>Cancelar</Button><Button disabled={busy || !!previewError} onClick={() => decideAsset()}>Salvar decisão</Button></DialogFooter>
      </DialogContent></Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Direcionar {editing?.cc_code} · {editing ? brl(Number(editing.amount)) : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Cliente</Label>
              <Select value={selClient} onValueChange={(v) => { setSelClient(v); setSelWork(ALL); }}><SelectTrigger><SelectValue placeholder="Escolha o cliente" /></SelectTrigger>
                <SelectContent>{(d?.clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Serviço</Label>
              <Select value={selWork} onValueChange={setSelWork} disabled={!selClient}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Ratear entre os serviços com movimentação</SelectItem>
                  {clientWorks.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.active ? "" : " (inativo)"}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={saveDirect} disabled={!selClient}>Lançar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

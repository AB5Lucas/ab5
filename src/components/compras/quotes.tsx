import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, FileText, Link2, Loader2, Paperclip, RefreshCw, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readPurchaseQuote } from "@/lib/purchase-quotes.functions";
import { priceInScUnit, quoteUnitPrice, type QuoteItemLite, type QuoteLite } from "@/lib/purchase-quotes";
import { brl } from "@/lib/purchase-requests";
import type { ScRow } from "@/components/compras/sc-shared";

export type RecItem = {
  id: string; item_no: number; quantity: number; unit: string; description: string; budget: number | null; notes: string | null;
  work_id: string | null; cc_code: string | null; rec_quote_item_id: string | null; status: string; quote_path: string | null; link_url: string | null;
  fa_item_reason?: string | null; fa_item_by?: string | null; fa_item_at?: string | null;
};
export type RecData = {
  req: ScRow; items: RecItem[]; quotes: QuoteLite[]; qItems: QuoteItemLite[];
  prefix: string | null; works: { id: string; name: string; cc_suffix: string | null }[];
};

/** Tudo o que a Recomendação precisa de uma SC: cabeçalho, itens, cotações lidas e itens das cotações. */
export function useRecData(id: string | null) {
  return useQuery({
    queryKey: ["sc-rec", id],
    enabled: !!id,
    queryFn: async (): Promise<RecData | null> => {
      const [r, it, q] = await Promise.all([
        supabase.from("purchase_requests").select("*").eq("id", id!).maybeSingle(),
        supabase.from("purchase_request_items").select("id, item_no, quantity, unit, description, budget, notes, work_id, cc_code, rec_quote_item_id, status, quote_path, link_url, fa_item_reason, fa_item_by, fa_item_at").eq("request_id", id!).order("item_no"),
        supabase.from("purchase_quotes").select("*").eq("request_id", id!).order("created_at"),
      ]);
      if (r.error) throw r.error;
      if (!r.data) return null;
      const quotes = (q.data ?? []) as QuoteLite[];
      const qi = quotes.length
        ? (await supabase.from("purchase_quote_items").select("*").in("quote_id", quotes.map((x) => x.id)).order("line_no")).data ?? []
        : [];
      const [pre, works] = r.data.client_id
        ? await Promise.all([
          supabase.from("clients").select("cc_prefix").eq("id", r.data.client_id).maybeSingle(),
          supabase.from("works").select("id, name, cc_suffix").eq("client_id", r.data.client_id),
        ])
        : [null, null];
      return {
        req: r.data as ScRow, items: (it.data ?? []) as RecItem[], quotes, qItems: qi as QuoteItemLite[],
        prefix: pre?.data?.cc_prefix ?? null, works: works?.data ?? [],
      };
    },
  });
}

/** Abre o arquivo da cotação (link assinado do bucket). */
export async function openQuoteFile(path: string) {
  if (/^https?:\/\//.test(path)) { window.open(path, "_blank", "noopener"); return; }
  const { data, error } = await supabase.storage.from("purchase-photos").createSignedUrl(path, 600);
  if (error || !data) { toast.error(error?.message ?? "Arquivo indisponível"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

const baseName = (p: string) => p.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "");

const isUrl = (p: string) => /^https?:\/\//i.test(p);
const linkUrl = (v: string) => (isUrl(v.trim()) ? v.trim() : `https://${v.trim()}`);
const linkName = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/**
 * Cotações anexadas pelo solicitante (no item ou na verba total) e os links de referência dos itens (do solicitante ou
 * do validador) entram na recomendação como as do comprador.
 */
async function ensureRequesterQuotes(d: RecData): Promise<string[]> {
  const known = new Set(d.quotes.map((q) => q.file_path));
  const files = [d.req.quote_path, ...d.items.map((i) => i.quote_path)].filter((p): p is string => !!p && !known.has(p));
  const links = d.items.map((i) => i.link_url?.trim()).filter((p): p is string => !!p).map(linkUrl).filter((p) => !known.has(p));
  const rows = [
    ...[...new Set(files)].map((p) => ({ request_id: d.req.id, file_path: p, file_name: isUrl(p) ? linkName(p) : baseName(p), source: "solicitante", kind: isUrl(p) ? "link" : "file" })),
    ...[...new Set(links)].map((p) => ({ request_id: d.req.id, file_path: p, file_name: linkName(p), source: "solicitante", kind: "link" })),
  ];
  if (!rows.length) return [];
  const { data, error } = await supabase.from("purchase_quotes")
    .upsert(rows, { onConflict: "request_id,file_path", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return (data ?? []).map((x) => x.id);
}

/** Traz as cotações/links do solicitante e do validador e já lê as novas; devolve quantas entraram. */
export async function importRequesterQuotes(d: RecData): Promise<number> {
  try {
    const fresh = await ensureRequesterQuotes(d);
    for (const id of fresh) {
      try { await readPurchaseQuote({ data: { quoteId: id } }); } catch { /* fica com erro na cotação */ }
    }
    return fresh.length;
  } catch { return 0; }
}

const ACCEPT = ".pdf,image/*,.xlsx,.xls,.xlsm,.csv";

/**
 * Clipe do Comprador: anexar cotações (PDF, foto ou Excel). Cada arquivo é lido pela IA (fornecedor, condições e
 * itens); as do solicitante entram sozinhas. Depois, "Vincular itens" abre a seleção item a item (como o TOTVS).
 */
export function QuotesAttachDialog({ row, onClose, onDone }: { row: ScRow | null; onClose: () => void; onDone: (requestId: string) => void }) {
  const qc = useQueryClient();
  const data = useRecData(row?.id ?? null);
  const [reading, setReading] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sc-rec", row?.id] }).then(() => qc.invalidateQueries({ queryKey: ["sc-rec-all"] }));

  const read = async (ids: string[]) => {
    if (!ids.length) return;
    setReading((s) => new Set([...s, ...ids]));
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await readPurchaseQuote({ data: { quoteId: id } });
        if (!r.ok) toast.error(`Cotação não lida: ${r.error}`);
      } catch (e) { toast.error((e as Error).message); }
      setReading((s) => { const n = new Set(s); n.delete(id); return n; });
      await refresh();
    }));
  };

  // Ao abrir: traz as cotações do solicitante e lê as que ainda não foram lidas.
  useEffect(() => {
    const d = data.data;
    if (!row || !d || prepared.current === row.id) return;
    prepared.current = row.id;
    void (async () => {
      try {
        const fresh = await ensureRequesterQuotes(d);
        const pending = d.quotes.filter((q) => q.read_status === "pendente").map((q) => q.id);
        if (fresh.length) await refresh();
        await read([...new Set([...fresh, ...pending])]);
      } catch (e) { toast.error((e as Error).message); }
    })();
  }, [row, data.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!row) prepared.current = null; }, [row]);

  const upload = async (files: FileList | null) => {
    if (!row || !files?.length) return;
    setUploading(true);
    const ids: string[] = [];
    try {
      for (const f of Array.from(files)) {
        const path = `quotes/${row.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("purchase-photos").upload(path, f);
        if (up.error) throw up.error;
        const ins = await supabase.from("purchase_quotes").insert({ request_id: row.id, file_path: path, file_name: f.name, source: "comprador" }).select("id").single();
        if (ins.error) throw ins.error;
        ids.push(ins.data.id);
      }
    } catch (e) { toast.error((e as Error).message); }
    setUploading(false);
    await refresh();
    await read(ids);
  };

  const [link, setLink] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const addLink = async () => {
    if (!row || !link.trim()) return;
    const url = linkUrl(link);
    const ins = await supabase.from("purchase_quotes").insert({ request_id: row.id, file_path: url, file_name: linkName(url), source: "comprador", kind: "link" }).select("id").single();
    if (ins.error) { toast.error(ins.error.code === "23505" ? "Este link já está nas cotações" : ins.error.message); return; }
    setLink("");
    await refresh();
    await read([ins.data.id]);
  };

  const remove = async (q: QuoteLite) => {
    const { error } = await supabase.from("purchase_quotes").delete().eq("id", q.id);
    if (error) { toast.error(error.message); return; }
    if (q.source === "comprador" && !isUrl(q.file_path)) await supabase.storage.from("purchase-photos").remove([q.file_path]);
    await refresh();
  };

  const quotes = data.data?.quotes ?? [];
  const qItems = data.data?.qItems ?? [];
  const locked = data.data?.req.fa_state === "em_aprovacao";
  const anyRead = quotes.some((q) => q.read_status === "lido");
  const busy = uploading || reading.size > 0;
  return (
    <>
      <Dialog open={!!row && !matching} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Cotações · {row?.number}</DialogTitle>
            <DialogDescription>PDF, foto, Excel ou link. Cada cotação é lida pela IA (fornecedor, prazo, pagamento e itens). As cotações e os links anexados pelo solicitante e pelo validador já entram aqui.</DialogDescription>
          </DialogHeader>
          {!locked && (
            <div className="flex gap-2">
              <Input placeholder="Colar link da cotação (loja, anúncio, PDF…)" value={link} onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addLink(); }} />
              <Button variant="outline" disabled={!link.trim()} onClick={() => void addLink()}><Link2 className="h-4 w-4" /> Adicionar link</Button>
            </div>
          )}
          {locked && <p className="rounded-md bg-amber-500/10 p-2 text-xs">Esta SC está em aprovação: as cotações não mudam até a decisão (ou puxe de volta na Recomendação).</p>}
          <div className={`max-h-[50vh] space-y-2 overflow-y-auto rounded-md transition-colors ${dragOver ? "bg-primary/5 ring-2 ring-primary/50" : ""}`}
            onDragOver={(e) => { if (locked) return; e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDragOver(false); }}
            onDrop={(e) => { if (locked) return; e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files); }}>
            {data.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {!data.isLoading && !quotes.length && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma cotação anexada.{!locked && <><br /><span className="text-xs">Arraste os arquivos para cá ou clique em Anexar cotações.</span></>}</p>}
            {!data.isLoading && quotes.length > 0 && !locked && <p className="text-center text-[11px] text-muted-foreground">Arraste mais arquivos para cá para anexar.</p>}
            {quotes.map((q) => {
              const n = qItems.filter((x) => x.quote_id === q.id).length;
              const isReading = reading.has(q.id);
              return (
                <div key={q.id} className="flex items-center gap-3 rounded-md border border-border p-2 text-sm">
                  <button type="button" className="shrink-0" title={isUrl(q.file_path) ? "Abrir link" : "Abrir arquivo"} onClick={() => void openQuoteFile(q.file_path)}>
                    {isUrl(q.file_path) ? <Link2 className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{q.supplier ?? q.file_name ?? baseName(q.file_path)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {q.source === "solicitante" ? "Do solicitante · " : ""}{q.file_name ?? baseName(q.file_path)}
                      {q.read_status === "lido" && ` · ${n} ${n === 1 ? "item" : "itens"}${q.total != null ? ` · ${brl(q.total)}` : ""}${q.payment_terms ? ` · ${q.payment_terms}` : ""}${q.delivery_days != null ? ` · entrega ${q.delivery_days} d` : ""}`}
                    </div>
                    {q.read_status === "erro" && !isReading && <div className="text-xs text-destructive"><AlertTriangle className="mr-1 inline h-3 w-3" />{q.read_error}</div>}
                  </div>
                  {isReading ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo…</span>
                    : q.read_status === "lido" ? <span className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Lida</span> : null}
                  {!locked && <Button variant="ghost" size="icon" className="h-7 w-7" title="Ler de novo" disabled={isReading} onClick={() => void read([q.id])}><RefreshCw className="h-3.5 w-3.5" /></Button>}
                  {!locked && <Button variant="ghost" size="icon" className="h-7 w-7" title="Tirar a cotação" disabled={isReading} onClick={() => void remove(q)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                </div>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {!locked ? (
              <Button variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Anexar cotações
              </Button>
            ) : <span />}
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              {!locked && <Button disabled={!anyRead || busy} onClick={() => setMatching(true)}>Vincular itens</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {row && matching && data.data && (
        <QuoteMatchingDialog data={data.data} onClose={() => setMatching(false)}
          onFinish={() => { setMatching(false); onClose(); onDone(row.id); }} />
      )}
    </>
  );
}

type Edit = { request_item_id: string | null; conv_factor: string; conv_type: string; discarded: boolean; price: string };
/** Dados da cotação que a leitura não achou e o comprador digita (fornecedor, prazos em dias). */
type QEdit = { supplier: string; payment: string; delivery: string; minOrder: string };
const numIn = (v: string) => { const t = v.trim(); if (!t) return null; const x = Number(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(x) ? x : NaN; };
const DISCARD = "__descartar__"; // valor interno do item descartado (o botão é a lixeira)
const NONE = "__nenhum__";

/**
 * Seleção item a item, como a "Seleção de Pedidos de Compra" do TOTVS: para cada item da SC, os itens das cotações
 * que serão ligados a ele, com Fator Conv. e Tipo de Conv (Multiplicador/Divisor); cada um pode ir para outro item
 * ou ser descartado. OK em sequência; no fim, os itens das cotações que ficaram sem vínculo.
 */
export function QuoteMatchingDialog({ data, onClose, onFinish }: { data: RecData; onClose: () => void; onFinish: () => void }) {
  const qc = useQueryClient();
  const items = useMemo(() => [...data.items].sort((a, b) => a.item_no - b.item_no), [data.items]);
  const readQuotes = data.quotes.filter((q) => q.read_status === "lido");
  const qById = new Map(readQuotes.map((q) => [q.id, q]));
  const [lines, setLines] = useState<QuoteItemLite[]>(() => data.qItems.filter((x) => qById.has(x.quote_id)));
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { request_item_id: l.request_item_id, conv_factor: String(l.conv_factor), conv_type: l.conv_type, discarded: l.discarded, price: "" }])));
  // Faltou na leitura: preço do item, fornecedor, prazo de pagamento ou de entrega → campo para digitar (obrigatório para seguir).
  const noPrice = (l: QuoteItemLite) => quoteUnitPrice(l) == null;
  const [qEdits, setQEdits] = useState<Record<string, QEdit>>(() =>
    Object.fromEntries(readQuotes.map((q) => [q.id, { supplier: "", payment: "", delivery: "", minOrder: "" }])));
  const qMiss = (q: QuoteLite) => ({ supplier: !q.supplier?.trim(), payment: q.payment_days == null || (q.payment_days === 0 && !q.payment_terms?.trim()), delivery: q.delivery_days == null, minOrder: q.min_order == null });
  const setQ = (id: string, p: Partial<QEdit>) => setQEdits((e) => ({ ...e, [id]: { ...e[id]!, ...p } }));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const last = items.length; // passo final = sem vínculo
  const cur = step < last ? items[step]! : null;
  const ed = (id: string) => edits[id]!;
  const set = (id: string, p: Partial<Edit>) => setEdits((e) => ({ ...e, [id]: { ...e[id]!, ...p } }));
  // Repetir um item da cotação em outro item da SC (ex.: a mesma trena pedida em duas linhas): grava uma cópia ligada a este item.
  const [repeating, setRepeating] = useState(false);
  const repeat = async (srcId: string) => {
    if (!cur) return;
    const src = lines.find((l) => l.id === srcId); if (!src) return;
    setRepeating(true);
    try {
      const e = ed(src.id);
      const typed = numIn(e.price);
      const { data: row, error } = await supabase.from("purchase_quote_items").insert({
        quote_id: src.quote_id, line_no: src.line_no, description: src.description, quantity: src.quantity, unit: src.unit,
        unit_price: src.unit_price ?? (typed != null && typed > 0 ? typed : null), total: src.total, request_item_id: cur.id,
        conv_factor: Number(e.conv_factor.replace(",", ".")) || 1, conv_type: e.conv_type, discarded: false,
      } as never).select("*").single();
      if (error) throw error;
      const copy = row as unknown as QuoteItemLite;
      setLines((ls) => [...ls, copy]);
      setEdits((x) => ({ ...x, [copy.id]: { request_item_id: cur.id, conv_factor: String(copy.conv_factor), conv_type: copy.conv_type, discarded: false, price: e.price } }));
      toast.success("Item da cotação repetido neste item da SC");
    } catch (err) { toast.error((err as Error).message); }
    setRepeating(false);
  };
  const shown = cur ? lines.filter((l) => !ed(l.id).discarded && ed(l.id).request_item_id === cur.id) : lines.filter((l) => !ed(l.id).discarded && !ed(l.id).request_item_id);
  // O que ainda falta digitar nas linhas deste passo (bloqueia o OK).
  const okNum = (v: string, min: number) => { const x = numIn(v); return x != null && !Number.isNaN(x) && x >= min; };
  const missing = (() => {
    const out: string[] = [];
    for (const l of shown) {
      const q = qById.get(l.quote_id); if (!q) continue;
      const m = qMiss(q), e = qEdits[q.id]!;
      const who = q.supplier || e.supplier || q.file_name || "cotação";
      if (noPrice(l) && !(okNum(ed(l.id).price, 0) && numIn(ed(l.id).price)! > 0)) out.push(`valor de "${l.description.slice(0, 30)}"`);
      if (m.supplier && !e.supplier.trim()) out.push(`fornecedor de ${q.file_name ?? "cotação"}`);
      if (m.payment && !okNum(e.payment, 0)) out.push(`prazo de pagamento de ${who}`);
      if (m.delivery && !okNum(e.delivery, 0)) out.push(`prazo de entrega de ${who}`);
      if (m.minOrder && !okNum(e.minOrder, 0)) out.push(`faturamento mínimo de ${who} (0 = sem mínimo)`);
    }
    return [...new Set(out)];
  })();
  const saveQuotes = async (quoteIds: string[]) => {
    for (const id of new Set(quoteIds)) {
      const q = qById.get(id); if (!q) continue;
      const m = qMiss(q), e = qEdits[id]!;
      const patch: Record<string, unknown> = {};
      if (m.supplier && e.supplier.trim()) patch["supplier"] = e.supplier.trim();
      if (m.payment && okNum(e.payment, 0)) { patch["payment_days"] = Math.round(numIn(e.payment)!); if (!qById.get(id)!.payment_terms?.trim()) patch["payment_terms"] = `${Math.round(numIn(e.payment)!)} dias (digitado)`; }
      if (m.delivery && okNum(e.delivery, 0)) patch["delivery_days"] = Math.round(numIn(e.delivery)!);
      if (m.minOrder && okNum(e.minOrder, 0)) patch["min_order"] = Math.round(numIn(e.minOrder)! * 100) / 100;
      if (Object.keys(patch).length) { const { error } = await supabase.from("purchase_quotes").update(patch as never).eq("id", id); if (error) throw error; }
    }
  };

  const save = async (ids: string[]) => {
    const changed = ids.filter((id) => {
      const l = lines.find((x) => x.id === id)!, e = ed(id);
      return l.request_item_id !== e.request_item_id || String(l.conv_factor) !== e.conv_factor || l.conv_type !== e.conv_type || l.discarded !== e.discarded || (noPrice(l) && !!e.price.trim());
    });
    for (const id of changed) {
      const e = ed(id);
      const f = Number(e.conv_factor.replace(",", "."));
      const l = lines.find((x) => x.id === id)!;
      const price = noPrice(l) ? numIn(e.price) : null;
      const { error } = await supabase.from("purchase_quote_items").update({
        request_item_id: e.discarded ? null : e.request_item_id, conv_factor: f > 0 ? f : 1, conv_type: e.conv_type, discarded: e.discarded,
        ...(price != null && price > 0 ? { unit_price: price, total: Math.round(price * Number(l.quantity || 1) * 100) / 100 } : {}),
      }).eq("id", id);
      if (error) throw error;
    }
  };
  const ok = async () => {
    setSaving(true);
    try {
      // Grava as linhas mexidas neste passo (as que estavam aqui no começo e as que estão agora).
      const ids = cur ? lines.filter((l) => l.request_item_id === cur.id || ed(l.id).request_item_id === cur.id).map((l) => l.id) : lines.map((l) => l.id);
      await saveQuotes(shown.map((l) => l.quote_id));
      await save(ids);
      if (step >= last) {
        await save(lines.map((l) => l.id));
        await supabase.from("purchase_quotes").update({ matched: true }).in("id", readQuotes.map((q) => q.id));
        await qc.invalidateQueries({ queryKey: ["sc-rec", data.req.id] });
        await qc.invalidateQueries({ queryKey: ["sc-rec-all"] });
        toast.success("Itens vinculados");
        onFinish();
      } else setStep(step + 1);
    } catch (e) { toast.error((e as Error).message); }
    setSaving(false);
  };

  const target = (l: QuoteItemLite) => (ed(l.id).discarded ? DISCARD : ed(l.id).request_item_id ?? NONE);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Seleção de itens das cotações · {data.req.number}</DialogTitle>
          <DialogDescription>
            {cur ? `Item ${step + 1} de ${items.length}: confira os itens das cotações ligados a ele, o fator de conversão e clique OK.` : "Itens das cotações sem vínculo: ligue a um item da SC ou descarte."}
          </DialogDescription>
        </DialogHeader>
        {cur && (
          <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm sm:grid-cols-[auto_auto_1fr_auto]">
            <div><div className="text-[11px] uppercase text-muted-foreground">Item</div><div className="font-medium">{cur.item_no}</div></div>
            <div><div className="text-[11px] uppercase text-muted-foreground">Quantidade</div><div className="font-medium">{cur.quantity} {cur.unit}</div></div>
            <div><div className="text-[11px] uppercase text-muted-foreground">Produto</div><div className="font-medium">{cur.description}</div></div>
            <div><div className="text-[11px] uppercase text-muted-foreground">Verba</div><div className="font-medium">{brl(cur.budget)}</div></div>
          </div>
        )}
        {cur && lines.some((l) => !ed(l.id).discarded && ed(l.id).request_item_id !== cur.id) && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="block text-xs">Repetir item da cotação neste item</Label>
              <Select value="" onValueChange={(v) => void repeat(v)} disabled={repeating}>
                <SelectTrigger className="h-8 w-[34rem] max-w-full text-xs"><SelectValue placeholder="Escolha um item já vinculado a outro item da SC…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {lines.filter((l) => !ed(l.id).discarded && ed(l.id).request_item_id !== cur.id).map((l) => {
                    const it = items.find((i) => i.id === ed(l.id).request_item_id);
                    const up = quoteUnitPrice(l);
                    return <SelectItem key={l.id} value={l.id}>{qById.get(l.quote_id)?.supplier ?? "—"} · {l.description.slice(0, 45)}{up != null ? ` · ${brl(up)}` : ""}{it ? ` (no item ${it.item_no})` : " (sem vínculo)"}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            {repeating && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}
        <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="min-w-56">Descrição na cotação</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead>Un.</TableHead>
                <TableHead className="text-right">Vlr. unit.</TableHead>
                <TableHead title="Prazo de pagamento (dias)">Pagto.</TableHead>
                <TableHead title="Prazo de entrega (dias)">Entrega</TableHead>
                <TableHead title="Faturamento mínimo do fornecedor (R$; 0 = sem mínimo)">Fat. mínimo</TableHead>
                <TableHead className="w-24">Fator Conv.</TableHead>
                <TableHead className="w-36">Tipo de Conv</TableHead>
                {cur && <TableHead className="text-right">Preço na un. da SC</TableHead>}
                {cur && <TableHead className="text-right">Total da SC</TableHead>}
                <TableHead className="min-w-52">Vincular a</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!shown.length && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">{cur ? "Nenhum item das cotações ligado a este item." : "Todos os itens das cotações estão vinculados ou descartados."}</TableCell></TableRow>}
              {shown.map((l) => {
                const e = ed(l.id);
                const typed = numIn(e.price);
                const up = quoteUnitPrice(l) ?? (typed != null && typed > 0 ? typed : null);
                const f = Number(e.conv_factor.replace(",", "."));
                const scPrice = up != null ? priceInScUnit(up, f > 0 ? f : 1, e.conv_type) : null;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">
                      {qMiss(qById.get(l.quote_id)!).supplier ? (
                        <Input className={`h-7 w-40 text-xs ${qEdits[l.quote_id]!.supplier.trim() ? "" : "border-destructive"}`} placeholder="Digite o fornecedor" value={qEdits[l.quote_id]!.supplier}
                          onChange={(ev) => setQ(l.quote_id, { supplier: ev.target.value })} aria-label="Fornecedor" />
                      ) : qById.get(l.quote_id)?.supplier}
                    </TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity ?? "—"}</TableCell>
                    <TableCell>{l.unit ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {noPrice(l) ? (
                        <Input className={`ml-auto h-7 w-24 text-right text-xs ${okNum(e.price, 0) && numIn(e.price)! > 0 ? "" : "border-destructive"}`} inputMode="decimal" placeholder="R$ unit." value={e.price}
                          onChange={(ev) => set(l.id, { price: ev.target.value })} aria-label="Valor unitário" title="A leitura não achou o valor: digite o valor unitário" />
                      ) : brl(up)}
                    </TableCell>
                    <TableCell>{(() => { const q = qById.get(l.quote_id)!; return qMiss(q).payment ? (
                      <Input className={`h-7 w-16 text-xs ${okNum(qEdits[q.id]!.payment, 0) ? "" : "border-destructive"}`} inputMode="numeric" placeholder="dias" value={qEdits[q.id]!.payment} onChange={(ev) => setQ(q.id, { payment: ev.target.value })} aria-label="Prazo de pagamento (dias)" title="Prazo de pagamento em dias (0 = à vista)" />
                    ) : `${q.payment_days} d`; })()}</TableCell>
                    <TableCell>{(() => { const q = qById.get(l.quote_id)!; return qMiss(q).delivery ? (
                      <Input className={`h-7 w-16 text-xs ${okNum(qEdits[q.id]!.delivery, 0) ? "" : "border-destructive"}`} inputMode="numeric" placeholder="dias" value={qEdits[q.id]!.delivery} onChange={(ev) => setQ(q.id, { delivery: ev.target.value })} aria-label="Prazo de entrega (dias)" title="Prazo de entrega em dias" />
                    ) : `${q.delivery_days} d`; })()}</TableCell>
                    <TableCell>{(() => { const q = qById.get(l.quote_id)!; return qMiss(q).minOrder ? (
                      <Input className={`h-7 w-24 text-xs ${okNum(qEdits[q.id]!.minOrder, 0) ? "" : "border-destructive"}`} inputMode="decimal" placeholder="R$ (0 = sem)" value={qEdits[q.id]!.minOrder} onChange={(ev) => setQ(q.id, { minOrder: ev.target.value })} aria-label="Faturamento mínimo (R$)" title="A leitura não achou o faturamento mínimo: digite o valor (0 = sem mínimo)" />
                    ) : Number(q.min_order) > 0 ? brl(q.min_order) : "sem mínimo"; })()}</TableCell>
                    <TableCell><Input className="h-7 w-20 text-xs" inputMode="decimal" value={e.conv_factor} onChange={(ev) => set(l.id, { conv_factor: ev.target.value })} aria-label="Fator de conversão" /></TableCell>
                    <TableCell>
                      <Select value={e.conv_type} onValueChange={(v) => set(l.id, { conv_type: v })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="M">Multiplicador</SelectItem><SelectItem value="D">Divisor</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                    {cur && <TableCell className="text-right tabular-nums">{brl(scPrice)}</TableCell>}
                    {cur && <TableCell className="text-right tabular-nums font-medium">{brl(scPrice != null ? scPrice * Number(cur.quantity) : null)}</TableCell>}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Select value={target(l)} onValueChange={(v) => set(l.id, { discarded: false, request_item_id: v === NONE ? null : v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.item_no}. {i.description.slice(0, 50)}</SelectItem>)}
                            {!cur && <SelectItem value={NONE}>Sem vínculo</SelectItem>}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Descartar este item da cotação" aria-label="Descartar"
                          onClick={() => set(l.id, { discarded: true, request_item_id: null })}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Fator Conv.: mesma quantidade e unidade = 1, Multiplicador. Unidades diferentes, ex.: SC 5 KG e cotação 1 RL (rolo de 5 kg) = fator 5, Divisor.
        </p>
        {missing.length > 0 && (
          <p className="text-xs text-destructive">Preencha o que a leitura não achou para continuar: {missing.slice(0, 4).join(", ")}{missing.length > 4 ? ` e mais ${missing.length - 4}` : ""}.</p>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">Passo {Math.min(step + 1, last + 1)} de {last + 1}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            {step > 0 && <Button variant="outline" disabled={saving} onClick={() => setStep(step - 1)}>Voltar</Button>}
            <Button disabled={saving || missing.length > 0} title={missing.length ? "Preencha os campos em vermelho" : undefined} onClick={() => void ok()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{step >= last ? "Concluir" : "OK"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

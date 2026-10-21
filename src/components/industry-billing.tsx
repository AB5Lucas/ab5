import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, CircleHelp, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { syncIndustryNow } from "@/lib/billing-sync.functions";
import { fetchAll } from "@/lib/results-engine";

const brl = (n: number | null) => n === null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s: string | null) => s ? new Date(s.includes("T") ? s : `${s}T12:00:00Z`).toLocaleString("pt-BR", s.includes("T") ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }) : "—";
export const RUN_STATUS: Record<string, string> = { completed: "Concluída", completed_pending: "Concluída com pendências", waiting: "Aguardando planilha", access_error: "Erro de acesso à fonte", error: "Erro de processamento", running: "Em andamento" };
const SOURCE: Record<string, string> = { pedidos: "Pedidos", faturamento: "Faturamento" };
const curMonth = () => new Date().toISOString().slice(0, 7);

function useRuns() {
  return useQuery({ queryKey: ["industry-sync", "runs"], refetchInterval: 15000, queryFn: async () => {
    const { data, error } = await supabase.from("billing_sync_runs").select("*").eq("category", "industria").order("started_at", { ascending: false }).limit(100);
    if (error) throw error; return data ?? [];
  } });
}
function useSync() {
  const qc = useQueryClient(); const fn = useServerFn(syncIndustryNow);
  return useMutation({ mutationFn: (month?: string) => fn({ data: { month } }), onSuccess: async (r) => {
    const bad = r.filter((x: any) => x.status && x.status !== "completed");
    bad.length ? toast.warning(bad.map((x: any) => `${SOURCE[x.source]} ${x.ym}: ${RUN_STATUS[x.status] ?? x.status}`).join(" · ")) : toast.success("Sincronização concluída");
    await qc.invalidateQueries({ queryKey: ["industry-sync"] }); await qc.invalidateQueries({ queryKey: ["work-result"] });
  }, onError: (e: Error) => toast.error(e.message) });
}
function SyncBar({ source }: { source: "pedidos" | "faturamento" }) {
  const runs = useRuns(); const sync = useSync(); const [month, setMonth] = useState(curMonth());
  const last = runs.data?.find(r => r.source === source);
  return <>
    <div className="flex flex-wrap items-end justify-end gap-2"><div><Label htmlFor={`ym-${source}`}>Mês de referência</Label><Input id={`ym-${source}`} type="month" min="2026-01" value={month} onChange={e => setMonth(e.target.value || curMonth())} className="w-40" /></div>
      <Button onClick={() => sync.mutate(month)} disabled={sync.isPending}><RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />{sync.isPending ? "Sincronizando…" : "Sincronizar agora"}</Button></div>
    <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-4 text-sm">
      <div><p className="font-medium">{last?.file_path?.split("/").pop() ?? (source === "pedidos" ? "AA MÊS.xlsx (PCP/PROGRAMAÇÃO)" : "Fat. Por Vendedor.xls")}</p><p className="text-muted-foreground">{last?.file_path ?? "—"} · Consulta diária às 06h</p></div>
      <div><p>Última execução: <strong>{date(last?.started_at ?? null)}</strong> · Referência {last?.ref_month ?? "—"}</p><p className="text-muted-foreground">{last ? `${RUN_STATUS[last.status] ?? last.status} · ${last.analyzed} analisados · ${last.inserted} novos · ${last.updated} atualizados · ${last.pending} pendentes` : "Nenhuma execução registrada"}</p></div>
    </div>
    {last?.error_message && <div role="alert" className={`rounded-md border p-3 text-sm ${last.status === "waiting" ? "border-border text-muted-foreground" : "border-destructive/30 text-destructive"}`}>{last.error_message}</div>}
  </>;
}
function State({ s, issue }: { s: string; issue?: string | null }) {
  const ok = s === "posted" || s === "ok"; const Icon = ok ? CheckCircle2 : CircleHelp;
  return <Badge variant="outline" title={issue ?? ""} className={`gap-1 whitespace-nowrap ${ok ? "text-success" : "text-muted-foreground"}`}><Icon className="h-3 w-3" />{ok ? (s === "posted" ? "Lançado" : "Importado") : "Pendente"}</Badge>;
}
function RunsTable() {
  const runs = useRuns();
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Início", "Fonte", "Referência", "Arquivo", "Situação", "Analisados", "Novos", "Atualizados", "Ignorados", "Pendentes", "Erros", "Mensagem"].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{runs.data?.map(r => <TableRow key={r.id}><TableCell className="whitespace-nowrap">{date(r.started_at)}</TableCell><TableCell>{SOURCE[r.source] ?? r.source}</TableCell><TableCell>{r.ref_month}</TableCell><TableCell className="max-w-64 truncate" title={r.file_path ?? ""}>{r.file_path?.split("/").pop()}</TableCell><TableCell className="whitespace-nowrap">{r.status === "waiting" && <Clock className="mr-1 inline h-3 w-3" />}{r.status.includes("error") && <AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />}{RUN_STATUS[r.status] ?? r.status}</TableCell><TableCell>{r.analyzed}</TableCell><TableCell>{r.inserted}</TableCell><TableCell>{r.updated}</TableCell><TableCell>{r.ignored}</TableCell><TableCell>{r.pending}</TableCell><TableCell>{r.errors}</TableCell><TableCell className="min-w-48">{r.error_message || "—"}</TableCell></TableRow>)}</TableBody></Table></div>;
}

export function IndustryBilling() {
  const [search, setSearch] = useState(""); const [state, setState] = useState("all");
  const inv = useQuery({ queryKey: ["industry-sync", "invoices"], refetchInterval: 15000, queryFn: () => fetchAll<any>((a, b) => supabase.from("industry_invoices").select("*").order("issued_at", { ascending: false }).order("id").range(a, b)) });
  const all = inv.data ?? [];
  const rows = useMemo(() => all.filter((n: any) => (state === "all" || n.status === state) && `${n.invoice_number} ${n.order_number ?? ""} ${n.client_name}`.toLowerCase().includes(search.toLowerCase())), [all, state, search]);
  const counts = [{ l: "Notas", v: all.length, I: CheckCircle2 }, { l: "Lançadas", v: all.filter((n: any) => n.status === "posted").length, I: CheckCircle2 }, { l: "Pendentes", v: all.filter((n: any) => n.status === "pending").length, I: CircleHelp }, { l: "Total faturado", v: brl(rows.reduce((a: number, n: any) => a + Number(n.amount), 0)), I: CheckCircle2 }];
  return <div className="space-y-5 pt-2"><SyncBar source="faturamento" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{counts.map(({ l, v, I }) => <div key={l} className="rounded-md border border-border bg-card p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{l}</span><I className="h-4 w-4" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{v}</p></div>)}</div>
    <Tabs defaultValue="notes"><TabsList><TabsTrigger value="notes">Notas</TabsTrigger><TabsTrigger value="runs">Execuções</TabsTrigger></TabsList>
      <TabsContent value="notes" className="space-y-4">
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Label htmlFor="ind-search">NF, pedido ou cliente</Label><Input id="ind-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar" /></div>
          <div className="flex gap-1">{[["all", "Todas"], ["posted", "Lançadas"], ["pending", "Pendentes"]].map(([k, v]) => <Button key={k} size="sm" variant={state === k ? "default" : "outline"} onClick={() => setState(k!)}>{v}</Button>)}</div></div>
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Emissão", "NF", "Cliente", "Pedido", "Valor", "Itens", "Situação", "Motivo"].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.map((n: any) => <TableRow key={n.id}><TableCell>{date(n.issued_at)}</TableCell><TableCell className="font-medium">{n.invoice_number}</TableCell><TableCell>{n.client_name}</TableCell><TableCell>{n.order_number || "—"}</TableCell><TableCell className="text-right tabular-nums">{brl(n.amount)}</TableCell><TableCell>{(n.items as unknown[]).length}</TableCell><TableCell><State s={n.status} /></TableCell><TableCell>{n.issue || "—"}</TableCell></TableRow>)}
            {!rows.length && <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">{inv.isLoading ? "Carregando…" : "Nenhuma nota encontrada"}</TableCell></TableRow>}</TableBody></Table></div>
      </TabsContent><TabsContent value="runs"><RunsTable /></TabsContent></Tabs>
  </div>;
}

export function IndustryOrders() {
  const [search, setSearch] = useState(""); const [month, setMonth] = useState("");
  const orders = useQuery({ queryKey: ["industry-sync", "orders"], refetchInterval: 15000, queryFn: () => fetchAll<any>((a, b) => supabase.from("industry_orders").select("*, works(name)").order("order_date", { ascending: false }).order("id").range(a, b)) });
  const inv = useQuery({ queryKey: ["industry-sync", "invoices"], queryFn: () => fetchAll<any>((a, b) => supabase.from("industry_invoices").select("*").order("id").range(a, b)) });
  const billed = useMemo(() => { const m = new Map<string, number>(); for (const i of inv.data ?? []) if (i.order_number) m.set(i.order_number, (m.get(i.order_number) ?? 0) + Number(i.amount)); return m; }, [inv.data]);
  const rows = (orders.data ?? []).filter((o: any) => (!month || (o.order_date ?? "").startsWith(month)) && `${o.order_number} ${o.client_name} ${o.works?.name ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5 pt-2"><SyncBar source="pedidos" />
    <div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="io-month">Mês do pedido</Label><Input id="io-month" type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" /></div><div className="min-w-48 flex-1"><Label htmlFor="io-search">Pedido, cliente ou serviço</Label><Input id="io-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar" /></div><span className="ml-auto text-sm text-muted-foreground">{rows.length} pedidos</span></div>
    <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Pedido", "Cliente", "Serviço", "Data", "Valor", "Matéria-prima", "Faturado", "Saldo", "Situação"].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((o: any) => { const b = billed.get(o.order_number) ?? 0; return <TableRow key={o.id}><TableCell className="font-medium">{o.order_number}</TableCell><TableCell>{o.client_name}</TableCell><TableCell>{o.works?.name ?? <span className="text-muted-foreground">{o.service_code || "—"}</span>}</TableCell><TableCell>{date(o.order_date)}</TableCell><TableCell className="text-right tabular-nums">{brl(o.amount)}</TableCell><TableCell className="text-right tabular-nums">{brl(o.raw_material)}</TableCell><TableCell className="text-right tabular-nums">{brl(b)}</TableCell><TableCell className="text-right tabular-nums">{brl(Number(o.amount) - b)}</TableCell><TableCell><State s={o.status} issue={o.issue} />{o.issue && <p className="mt-1 text-xs text-muted-foreground">{o.issue}</p>}</TableCell></TableRow>; })}
        {!rows.length && <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">{orders.isLoading ? "Carregando…" : "Nenhum pedido encontrado"}</TableCell></TableRow>}</TableBody></Table></div>
  </div>;
}

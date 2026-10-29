import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CornerDownRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { directPurchase, syncPurchasesNow } from "@/lib/purchases.functions";

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

type Line = { id: string; ref_month: string; cc_code: string; cc_name: string | null; amount: number; status: string; reason: string | null; target_client_id: string | null; target_work_id: string | null };

function ComprasPage() {
  const qc = useQueryClient();
  const sync = useServerFn(syncPurchasesNow);
  const direct = useServerFn(directPurchase);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Line | null>(null);
  const [selClient, setSelClient] = useState<string>("");
  const [selWork, setSelWork] = useState<string>(ALL);

  const data = useQuery({
    queryKey: ["purchase-lines"],
    queryFn: async () => {
      const [l, c, w] = await Promise.all([
        supabase.from("purchase_cc_lines").select("id, ref_month, cc_code, cc_name, amount, status, reason, target_client_id, target_work_id").order("ref_month", { ascending: false }).order("cc_code"),
        supabase.from("clients").select("id, name").order("name"),
        supabase.from("works").select("id, name, client_id, active").order("name"),
      ]);
      if (l.error) throw l.error;
      if (c.error) throw c.error;
      if (w.error) throw w.error;
      const ids = l.data.map((x) => x.id);
      const entries: { purchase_cc_id: string | null; work_id: string; amount: number }[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: e, error } = await supabase.from("work_entries").select("purchase_cc_id, work_id, amount").in("purchase_cc_id", ids.slice(i, i + 200));
        if (error) throw error;
        entries.push(...(e ?? []));
      }
      return { lines: l.data as Line[], clients: c.data, works: w.data, entries };
    },
  });

  const d = data.data;
  const workName = useMemo(() => {
    const cn = new Map((d?.clients ?? []).map((c) => [c.id, c.name]));
    return new Map((d?.works ?? []).map((w) => [w.id, `${cn.get(w.client_id ?? "") ?? "—"} · ${w.name}`]));
  }, [d]);
  const months = useMemo(() => [...new Set((d?.lines ?? []).map((l) => l.ref_month))], [d]);
  const rows = useMemo(() => (d?.lines ?? []).filter((l) =>
    (month === ALL || l.ref_month === month) && (status === ALL || l.status === status) &&
    (!q || `${l.cc_code} ${l.cc_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [d, month, status, q]);
  const totals = useMemo(() => {
    const base = (d?.lines ?? []).filter((l) => month === ALL || l.ref_month === month);
    const sum = (s?: string) => base.filter((l) => !s || l.status === s).reduce((a, l) => a + Number(l.amount), 0);
    return { all: sum(), launched: sum("launched"), pending: sum("pending"), pendingCount: base.filter((l) => l.status === "pending").length };
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

  function openDirect(l: Line) {
    setEditing(l);
    setSelClient(l.target_client_id ?? "");
    setSelWork(l.target_work_id ?? ALL);
  }
  async function saveDirect() {
    if (!editing || !selClient) return;
    try {
      const st = await direct({ data: { id: editing.id, client_id: selClient, work_id: selWork === ALL ? null : selWork } });
      toast[st === "launched" ? "success" : "warning"](st === "launched" ? "Compra lançada" : "Ainda pendente: o cliente não teve movimentação no mês. Escolha um serviço.");
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
        actions={<Button size="sm" onClick={runSync} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sincronizar</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Total de compras</p><p className="text-lg font-semibold">{brl(totals.all)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Lançado nos serviços</p><p className="text-lg font-semibold">{brl(totals.launched)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Pendente ({totals.pendingCount})</p><p className="text-lg font-semibold">{brl(totals.pending)}</p></div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>Mês</Label>
          <Select value={month} onValueChange={setMonth}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todos</SelectItem>{months.map((m) => <SelectItem key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todos</SelectItem><SelectItem value="launched">Lançados</SelectItem><SelectItem value="pending">Pendentes</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label>Busca</Label><Input className="w-64" placeholder="Centro de custo ou nome" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Mês</TableHead><TableHead>Centro de custo</TableHead><TableHead className="text-right">Valor</TableHead>
            <TableHead>Status</TableHead><TableHead>Lançado em</TableHead><TableHead className="w-12" />
          </TableRow></TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
            {!data.isLoading && !rows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma compra. Clique em Sincronizar.</TableCell></TableRow>}
            {rows.map((l) => {
              const parts = (d?.entries ?? []).filter((e) => e.purchase_cc_id === l.id);
              return (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">{l.ref_month.slice(5)}/{l.ref_month.slice(0, 4)}</TableCell>
                  <TableCell><span className="font-mono text-xs">{l.cc_code}</span> <span className="text-sm">{l.cc_name}</span></TableCell>
                  <TableCell className="text-right whitespace-nowrap">{brl(Number(l.amount))}</TableCell>
                  <TableCell>{l.status === "launched" ? <Badge variant="secondary">Lançado</Badge> : <Badge variant="destructive" title={l.reason ?? ""}>Pendente</Badge>}</TableCell>
                  <TableCell className="text-xs">
                    {parts.length ? parts.map((p, i) => <div key={i}>{workName.get(p.work_id) ?? "—"}{parts.length > 1 ? ` · ${brl(Number(p.amount))}` : ""}</div>) : <span className="text-muted-foreground">{l.reason}</span>}
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" title="Direcionar" onClick={() => openDirect(l)}><CornerDownRight className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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

import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { syncMarsNow } from "@/lib/billing-sync.functions";
import { RUN_STATUS, syncPoll } from "@/components/industry-billing";
import { MARS_CONTRACT_ORDER, marsFile } from "@/lib/mars-sync";

const brl = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const when = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const curMonth = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const ACTION: Record<string, { label: string; cls: string }> = {
  created: { label: "Serviço criado", cls: "text-success" },
  existing: { label: "Já existia", cls: "text-muted-foreground" },
  contract: { label: "Medição do contrato", cls: "text-primary" },
};

/**
 * Pedidos › MARS MM: leitura diária da planilha "Faturamento MARS <ano>.xlsx" (aba do mês, tabela GESTÃO DE ORDENS DE
 * SERVIÇOS). Cada item vira um serviço (BDI, andamento 100%, gestor Felipe Hideki Oki); a medição do CONTRATO
 * SANITATION vira novas linhas do pedido do contrato nos serviços que já o têm.
 */
export function MarsOrders() {
  const qc = useQueryClient();
  const fn = useServerFn(syncMarsNow);
  const [month, setMonth] = useState(curMonth());
  const [view, setView] = useState("all");
  const runs = useQuery({
    queryKey: ["mars-sync", "runs"],
    refetchInterval: (q) => syncPoll(q.state.data),
    queryFn: async () => {
      const { data, error } = await supabase.from("billing_sync_runs").select("*").eq("category", "mars").order("started_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });
  const items = useQuery({
    queryKey: ["mars-sync", "items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mars_sync_items").select("*, works(name)").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const sync = useMutation({
    mutationFn: () => fn({ data: { month } }),
    onSuccess: async (r: any) => {
      if (r?.status === "completed") toast.success(`Leitura concluída: ${r.created ?? 0} serviço(s) criado(s), ${r.updated ?? 0} atualizado(s)`);
      else toast.warning(`${RUN_STATUS[r?.status] ?? r?.status}${r?.message ? ` · ${r.message}` : ""}`);
      await qc.invalidateQueries({ queryKey: ["mars-sync"] });
      await qc.invalidateQueries({ queryKey: ["work-result"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const last = runs.data?.[0];
  const rows = useMemo(() => (items.data ?? []).filter((r) => view === "all" || r.action === view), [items.data, view]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">{marsFile(month).split("/").pop()}</p>
          <p className="text-muted-foreground">{marsFile(month)} · aba do mês, tabela Gestão de Ordens de Serviços · consulta diária às 06h</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="mars-ym" className="block">Mês da aba</Label>
            <Input id="mars-ym" type="month" min="2026-01" className="w-40" value={month} onChange={(e) => setMonth(e.target.value || curMonth())} />
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />{sync.isPending ? "Sincronizando…" : "Sincronizar"}
          </Button>
        </div>
      </div>
      <div className="border-b border-border pb-3 text-sm">
        <p>Última leitura: <strong>{when(last?.started_at ?? null)}</strong> · Aba {last?.ref_month ?? "—"}</p>
        <p className="text-muted-foreground">
          {last ? `${RUN_STATUS[last.status] ?? last.status} · ${last.analyzed} linhas · ${last.inserted} serviços criados · ${last.updated} atualizados · ${last.ignored} ignorados` : "Nenhuma leitura registrada"}
        </p>
        {last?.error_message && (
          <p role="alert" className={`mt-1 ${last.status.includes("error") ? "text-destructive" : "text-muted-foreground"}`}>
            {last.status.includes("error") && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{last.error_message}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Cada item da planilha vira um serviço próprio (não mensal), com BDI e andamento 100% (dá para mudar depois em Resultados). O
        CONTRATO SANITATION não cria serviço: cada medição entra como nova linha do pedido {MARS_CONTRACT_ORDER} nos serviços do contrato,
        na proporção da medição anterior, somando o valor do contrato. Itens cancelados e pedidos já lançados em algum serviço não são criados de novo.
      </p>
      <div className="space-y-1">
        <Label className="block text-xs">Mostrar</Label>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos ({items.data?.length ?? 0})</SelectItem>
            {Object.entries(ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.label} ({(items.data ?? []).filter((r) => r.action === k).length})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {["Nº Orç.", "Pedido", "Descrição", "Valor", "Cliente (MARS)", "Categoria", "Status na planilha", "Aba", "Resultado", "Serviço"].map((h) => <TableHead key={h}>{h}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">{items.isLoading ? "Carregando..." : "Nada lido ainda."}</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap">{r.quote ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.order_number ?? <span className="text-muted-foreground">sem pedido</span>}</TableCell>
                <TableCell className="min-w-64">{r.description}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{brl(Number(r.value))}</TableCell>
                <TableCell className="whitespace-nowrap">{r.requester ?? "—"}</TableCell>
                <TableCell>{r.category ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.sheet_status ?? "—"}</TableCell>
                <TableCell>{r.ref_month}</TableCell>
                <TableCell><Badge variant="outline" className={ACTION[r.action]?.cls}>{ACTION[r.action]?.label ?? r.action}</Badge></TableCell>
                <TableCell className="min-w-48">
                  {r.work_id ? r.works?.name ?? "—" : r.action === "contract" ? "Serviços do contrato" : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

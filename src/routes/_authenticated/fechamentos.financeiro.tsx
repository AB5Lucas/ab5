import { marginPercent, meanMarginPercent } from "@/lib/result-labor";
import { MarginPercent } from "@/components/margin-percent";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contractFraction } from "@/lib/contract";
import { ResultadoPage } from "./obras.resultado";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadResultShared, monthEnd } from "@/lib/results-engine";
import { FIN_TAX, buildFinanceGroups, financeBatches, financeList, loadFinanceActive, loadFinanceRaws, type FinanceLine } from "@/lib/finance-data";

export const Route = createFileRoute("/_authenticated/fechamentos/financeiro")({
  head: () => ({
    meta: [
      { title: "Fechamento Financeiro | AB5 Hub" },
      { name: "description", content: "Relatório financeiro gerencial por cliente e serviço, a partir de Resultados." },
      { property: "og:title", content: "Fechamento Financeiro | AB5 Hub" },
      { property: "og:description", content: "Faturamento, impostos, custos e margens por período." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinanceiroPage,
});

const EMPTY_RAWS = new Map<string, any>();
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

type Line = FinanceLine;

function FinanceiroPage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [months, setMonths] = useState<number[]>([now.getMonth() + 1]);
  const [detail, setDetail] = useState<Line | null>(null);
  // Clientes ocultos (salvos no navegador); padrão: todos visíveis
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem("fin-hidden-clients") ?? "[]")); } catch { /* ignore */ }
  }, []);
  const saveHidden = (h: string[]) => { setHidden(h); localStorage.setItem("fin-hidden-clients", JSON.stringify(h)); };
  const yms = useMemo(() => [...months].sort((a, b) => a - b).map((m) => `${year}-${String(m).padStart(2, "0")}`), [year, months]);
  const start = yms.length ? `${yms[0]}-01` : `${year}-01-01`;
  const end = yms.length ? monthEnd(yms[yms.length - 1]!) : `${year}-12-31`;

  const works = useQuery({
    queryKey: ["fin-works"],
    queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [],
  });
  const holidays = useQuery({
    queryKey: ["holidays-dates"],
    queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string),
  });
  // Serviços com movimento no período (lançamentos, RDOs ou escala)
  const active = useQuery({
    queryKey: ["fin-active", start, end],
    queryFn: () => loadFinanceActive(start, end),
  });
  // Qualquer serviço (inclusive concluído/inativo) com movimento ou pedido datado no período
  const list = useMemo(() => financeList(works.data ?? [], active.data, start, end), [works.data, active.data, start, end]);
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const clientBatches = useMemo(() => financeBatches(list), [list]);
  // Um carregamento em lote para todos os clientes do período (antes: ~17 consultas por cliente)
  const batchKey = useMemo(() => clientBatches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [clientBatches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey],
    staleTime: 60_000,
    enabled: !!shared.data && !!active.data,
    queryFn: () => loadFinanceRaws(clientBatches, shared.data!),
  });
  const rawByWork = raws.data ?? EMPTY_RAWS;
  const loading = works.isLoading || active.isLoading || shared.isLoading || (list.length > 0 && raws.isPending);

  const groups = useMemo(() => buildFinanceGroups(list, rawByWork, yms, year, holidays.data ?? [], works.data ?? []), [list, rawByWork, yms, year, holidays.data, works.data]);

  const allGroups = groups;
  const shown = useMemo(() => allGroups.filter((g) => !hidden.includes(g.key)), [allGroups, hidden]);
  const sum = (f: (l: Line) => number) => shown.reduce((a, g) => a + g.lines.reduce((b, l) => b + f(l), 0), 0);
  const tBilled = sum((l) => l.billed);
  const tMargin = sum((l) => l.margin);
  const toggle = (m: number) => setMonths((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - 3 + i));

  return (
    <div className="space-y-6">
      <PageHeader title="Fechamento" description="Entradas e saídas por cliente e serviço, com base em Resultados. Impostos de 18,5% sobre o faturamento." />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Ano</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Meses</Label>
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((m, i) => (
              <Button key={m} size="sm" variant={months.includes(i + 1) ? "default" : "outline"} onClick={() => toggle(i + 1)}>{m}</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setMonths(months.length === 12 ? [] : MONTHS.map((_, i) => i + 1))}>
              {months.length === 12 ? "Limpar" : "Todos"}
            </Button>
          </div>
        </div>
        <div>
          <Label>Clientes</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="block">
                {hidden.filter((k) => allGroups.some((g) => g.key === k)).length ? `${allGroups.filter((g) => !hidden.includes(g.key)).length} de ${allGroups.length}` : "Todos"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              <div className="mb-2 flex justify-between">
                <Button size="sm" variant="ghost" onClick={() => saveHidden([])}>Todos</Button>
                <Button size="sm" variant="ghost" onClick={() => saveHidden([...new Set([...hidden, ...allGroups.map((g) => g.key)])])}>Nenhum</Button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {allGroups.map((g) => (
                  <label key={g.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                    <Checkbox
                      checked={!hidden.includes(g.key)}
                      onCheckedChange={(c) => saveHidden(c ? hidden.filter((k) => k !== g.key) : [...hidden, g.key])}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="panel max-h-[calc(100vh-13rem)] overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
            <TableRow>
              <TableHead>Serviço</TableHead>
              <TableHead className="text-right">Valor faturado</TableHead>
              <TableHead className="text-right">Impostos</TableHead>
              <TableHead className="text-right">Mão de obra</TableHead>
              <TableHead className="text-right">Transporte</TableHead>
              <TableHead className="text-right">Materiais</TableHead>
              <TableHead className="text-right">Margem de contribuição</TableHead>
              <TableHead className="text-right">% Andamento</TableHead>
              <TableHead className="text-right">Margem do mês</TableHead>
              <TableHead className="text-right">Margem total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!months.length && <TableRow><TableCell colSpan={10} className="text-muted-foreground">Selecione ao menos um mês.</TableCell></TableRow>}
            {months.length > 0 && loading && <TableRow><TableCell colSpan={10}>Carregando...</TableCell></TableRow>}
            {months.length > 0 && !loading && !groups.length && <TableRow><TableCell colSpan={10} className="text-muted-foreground">Nenhuma movimentação no período.</TableCell></TableRow>}
            {months.length > 0 && shown.map((g) => (
              <Fragment key={g.name}>
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={10} className="font-display font-semibold uppercase tracking-wide">{g.name}</TableCell>
                </TableRow>
                {g.lines.map((l) => (
                  <TableRow key={l.work.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetail(l)}>
                    <TableCell className="pl-6 underline-offset-2 hover:underline">{l.work.name}</TableCell>
                    <TableCell className="text-right">{brl(l.billed)}</TableCell>
                    <TableCell className="text-right">{brl(l.tax)}</TableCell>
                    <TableCell className="text-right">{brl(l.mo)}</TableCell>
                    <TableCell className="text-right">{brl(l.transport)}</TableCell>
                    <TableCell className="text-right">{brl(l.materials)}</TableCell>
                    <TableCell className={`text-right font-medium ${l.margin < 0 ? "text-destructive" : ""}`}>{brl(l.margin)}</TableCell>
                    <TableCell className="text-right">{pct(l.progress)}</TableCell>
                    <TableCell className="text-right"><MarginPercent value={l.monthPct} margin={l.margin} /></TableCell>
                    <TableCell className={`text-right ${l.total.margin < 0 ? "text-destructive" : ""}`}><MarginPercent value={l.total.pct} margin={l.total.margin} /> <span className="text-xs text-muted-foreground">({brl(l.total.margin)})</span></TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
          {shown.length > 0 && months.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{brl(tBilled)}</TableCell>
                <TableCell className="text-right">{brl(sum((l) => l.tax))}</TableCell>
                <TableCell className="text-right">{brl(sum((l) => l.mo))}</TableCell>
                <TableCell className="text-right">{brl(sum((l) => l.transport))}</TableCell>
                <TableCell className="text-right">{brl(sum((l) => l.materials))}</TableCell>
                <TableCell className="text-right">{brl(tMargin)}</TableCell>
                <TableCell />
                <TableCell className="text-right">{<MarginPercent value={marginPercent(tMargin, tBilled)} margin={tMargin} />}</TableCell>
                <TableCell className="text-right">
                  {(() => {
                    const ls = shown.flatMap((g) => g.lines);
                    const n = ls.length || 1;
                    const m = ls.reduce((a, l) => a + l.total.margin, 0) / n;
                    const p = meanMarginPercent(ls.map((l) => l.total.pct), m);
                    return <MarginPercent value={p} margin={m} />;
                  })()}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </table>
      </div>
      <DetailDialog line={detail} months={yms} onClose={() => setDetail(null)} />
    </div>
  );
}

function DetailDialog({ line, months, onClose }: { line: Line | null; months: string[]; onClose: () => void }) {
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[98vw] w-[98vw] h-[96vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{line?.work.clients?.name ?? line?.work.client} — {line?.work.name}</DialogTitle></DialogHeader>
        {line && <ResultadoPage key={`${line.work.id}:${months.join(",")}`} initialWorkId={line.work.id} initialMonths={months} />}
      </DialogContent>
    </Dialog>
  );
}

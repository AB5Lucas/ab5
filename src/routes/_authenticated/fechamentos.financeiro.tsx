import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
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
import { buildBase, fetchAll, loadWorkData, loadResultShared, sliceResultRaw, monthEnd, monthlyOrderRevenue, progressUntil, totalMargin } from "@/lib/results-engine";

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

const FIN_TAX = 0.185; // imposto do relatório Financeiro
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

type Line = {
  work: any; billed: number; tax: number; mo: number; transport: number; materials: number;
  margin: number; progress: number; monthPct: number; total: { margin: number; pct: number }; full: any; raw: any;
};

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
    queryFn: async () => {
      const out = new Set<string>();
      const [ent, rdo, sch] = await Promise.all([
        fetchAll<any>((a, b) =>
          supabase.from("work_entries").select("work_id").eq("sync_cancelled", false)
            .or(`and(entry_date.gte.${start},entry_date.lte.${end}),and(competence_month.gte.${start.slice(0, 7)},competence_month.lte.${end.slice(0, 7)})`)
            .order("id").range(a, b),
        ),
        fetchAll<any>((a, b) => supabase.from("rdos").select("work_id").gte("report_date", start).lte("report_date", end).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("daily_schedules").select("id").gte("schedule_date", start).lte("schedule_date", end).order("id").range(a, b)),
      ]);
      ent.forEach((r) => out.add(r.work_id));
      rdo.forEach((r) => out.add(r.work_id));
      const ids = sch.map((s) => s.id);
      for (let i = 0; i < ids.length; i += 200) {
        const rows = await fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id").in("schedule_id", ids.slice(i, i + 200)).order("id").range(a, b));
        rows.forEach((r) => out.add(r.work_id));
      }
      return out;
    },
  });
  // Qualquer serviço (inclusive concluído/inativo) com movimento ou pedido datado no período
  const list = useMemo(() => (works.data ?? []).filter((w: any) =>
    active.data?.has(w.id) ||
    (Array.isArray(w.orders) && w.orders.some((o: any) => o?.date && String(o.date).slice(0, 10) >= start && String(o.date).slice(0, 10) <= end)),
  ), [works.data, active.data, start, end]);
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const clientBatches = useMemo(() => [...new Set(list.map((w: any) => w.client_id ?? w.id))].map((key) => {
    const selected = list.filter((w: any) => (w.client_id ?? w.id) === key);
    return { key, work: selected[0], ids: selected.map((w: any) => w.id) };
  }), [list]);
  const clientRaws = useQueries({
    queries: clientBatches.map((batch) => ({
      queryKey: ["fin-client-raw", batch.key, batch.ids.join(",")],
      staleTime: 60_000,
      enabled: !!shared.data,
      queryFn: () => loadWorkData(batch.work, batch.ids, false, shared.data),
    })),
  });
  const rawByWork = useMemo(() => {
    const out = new Map<string, any>();
    clientBatches.forEach((batch, index) => { const raw = clientRaws[index]?.data; if (raw) for (const id of batch.ids) out.set(id, sliceResultRaw(raw, id)); });
    return out;
  }, [clientBatches, clientRaws]);
  const loading = works.isLoading || active.isLoading || shared.isLoading || clientRaws.some((r) => r.isPending);

  const groups = useMemo(() => {
    const sel = new Set(yms);
    const by = new Map<string, { key: string; name: string; lines: Line[] }>();
    list.forEach((w: any, i: number) => {
      const raw = rawByWork.get(w.id);
      if (!raw) return;
      const full = buildBase(w, raw, "", "", { isAll: false, workIds: [w.id], holidays: holidays.data ?? [], allWorks: works.data ?? [] });
      if (!full) return;
      let mo = 0, transport = 0, materials = 0, compBilled = 0, billed = 0;
      for (const r of full.rows) if (sel.has(r.ym)) { mo += r.labor; transport += r.transport; }
      for (const e of raw.entries as any[]) {
        const v = Number(e.amount);
        // Valor faturado exibido pelo mês do lançamento; margem pela competência
        if (e.category === "faturamento" && sel.has(String(e.doc_date ?? e.entry_date).slice(0, 7))) billed += v;
        if (!sel.has(e.entry_date.slice(0, 7))) continue;
        if (e.category === "faturamento") compBilled += v;
        else if (e.category === "mao_obra") mo += v;
        else if (e.category === "terceiros") transport += v;
        else if (["materiais", "ferramentas", "andaimes"].includes(e.category)) materials += v;
      }
      const tax = billed * FIN_TAX;
      const margin = compBilled * (1 - FIN_TAX) - mo - transport - materials;
      const hasOrder = (Array.isArray(w.orders) ? w.orders : []).some((o: any) => o?.date && sel.has(String(o.date).slice(0, 7)));
      if (!billed && !compBilled && !mo && !transport && !materials && !hasOrder) return;
      const lastYm = yms[yms.length - 1] ?? `${year}-12`;
      const progress = progressUntil(w, full, lastYm);
      const key = w.client_id ?? `n:${w.client ?? "Sem cliente"}`;
      const g = by.get(key) ?? { key, name: w.clients?.name ?? w.client ?? "Sem cliente", lines: [] as Line[] };
      const upto = buildBase(w, raw, "", lastYm, { isAll: false, workIds: [w.id], holidays: holidays.data ?? [], allWorks: works.data ?? [] }) ?? full;
      // Mensal com período filtrado: Margem Total = margem mensal do período (soma dos pedidos datados nos meses filtrados)
      let total = totalMargin(w, upto);
      if (w.monthly_enabled && months.length > 0) {
        const rev = monthlyOrderRevenue(w, "", "", yms);
        const m = rev * (1 - FIN_TAX) - (mo + transport + materials);
        total = { margin: m, pct: rev ? (m / rev) * 100 : 0 };
      }
      g.lines.push({ work: w, billed, tax, mo, transport, materials, margin, progress, monthPct: compBilled ? (margin / compBilled) * 100 : 0, total, full, raw });
      by.set(key, g);
    });
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [list, rawByWork, yms, year, months.length, holidays.data, works.data]);

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
                    <TableCell className={`text-right ${l.monthPct < 0 ? "text-destructive" : ""}`}>{pct(l.monthPct)}</TableCell>
                    <TableCell className={`text-right ${l.total.margin < 0 ? "text-destructive" : ""}`}><span>{pct(l.total.pct)}</span> <span className="text-xs text-muted-foreground">({brl(l.total.margin)})</span></TableCell>
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
                <TableCell className="text-right">{pct(tBilled ? (tMargin / tBilled) * 100 : 0)}</TableCell>
                <TableCell className="text-right">
                  {(() => {
                    const ls = shown.flatMap((g) => g.lines);
                    const n = ls.length || 1;
                    const m = ls.reduce((a, l) => a + l.total.margin, 0) / n;
                    const p = ls.reduce((a, l) => a + l.total.pct, 0) / n;
                    void m; return pct(p);
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

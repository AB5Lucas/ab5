import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/obras/resultado")({
  head: () => ({
    meta: [
      { title: "Resultado da Obra | AB5 Hub" },
      { name: "description", content: "Margem de contribuição proporcional ao andamento de cada serviço." },
      { property: "og:title", content: "Resultado da Obra | AB5 Hub" },
      { property: "og:description", content: "Receita proporcional, custo realizado e margem por serviço." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResultadoPage,
});

/** Multiplicador de encargos sobre o valor hora do colaborador. */
const ENCARGOS = 2.6;
const KM_RATE = 1.35;
const DEFAULT_HOURS = 8;

const CATEGORIES = [
  { key: "materiais", label: "Materiais" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "andaimes", label: "Andaimes" },
  { key: "terceiros", label: "Transporte de terceiros" },
  { key: "faturamento", label: "Faturamento" },
] as const;
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

/** Itens de custo orçados/realizados. */
const ITEMS = [
  { key: "mo", label: "Mão de obra" },
  { key: "transporte", label: "Transporte" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "materiais", label: "Materiais" },
  { key: "andaimes", label: "Andaimes" },
] as const;
type ItemKey = (typeof ITEMS)[number]["key"];
const entryItem = (cat: string): ItemKey | null =>
  cat === "terceiros" ? "transporte" : cat === "ferramentas" || cat === "materiais" || cat === "andaimes" ? cat : null;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
};
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function ResultadoPage() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const [workId, setWorkId] = useState<string>("");

  const works = useQuery({
    queryKey: ["works-result"],
    queryFn: async () => {
      const { data, error } = await supabase.from("works").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const work = works.data?.find((w) => w.id === workId);

  const data = useQuery({
    queryKey: ["work-result", workId],
    enabled: !!work,
    queryFn: async () => {
      const w = work!;
      const [allocs, rdoWf, progress, entries, people, siblings, vs, client] = await Promise.all([
        fetchAll<any>((a, b) =>
          supabase.from("daily_allocations").select("collaborator_id, daily_schedules(schedule_date)").eq("work_id", w.id).range(a, b),
        ),
        fetchAll<any>((a, b) =>
          supabase.from("rdo_workforce").select("collaborator_id, report_date, present, worked_hours").eq("work_id", w.id).range(a, b),
        ),
        supabase.from("work_progress").select("*").eq("work_id", w.id).order("month"),
        supabase.from("work_entries").select("*").eq("work_id", w.id).order("entry_date", { ascending: false }),
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, salary").range(a, b)),
        w.client_id ? supabase.from("works").select("id").eq("client_id", w.client_id) : Promise.resolve({ data: [] as any[] }),
        w.client_id
          ? fetchAll<any>((a, b) =>
              supabase.from("vehicle_schedules").select("schedule_date, km, trips, client_id").eq("client_id", w.client_id!).range(a, b),
            )
          : Promise.resolve([] as any[]),
        w.client_id
          ? supabase.from("clients").select("has_toll, toll_amount").eq("id", w.client_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      return {
        allocs,
        rdoWf,
        progress: progress.data ?? [],
        entries: entries.data ?? [],
        people,
        siblingCount: Math.max(1, (siblings as any).data?.length ?? 1),
        vs,
        client: (client as any).data,
      };
    },
  });

  // ---------- Cálculos ----------
  const calc = useMemo(() => {
    if (!work || !data.data) return null;
    const d = data.data;
    const rate = new Map<string, number>(d.people.map((p: any) => [p.id, Number(p.salary ?? 0)]));
    const rdoKey = new Map<string, any>(d.rdoWf.map((r: any) => [`${r.collaborator_id}|${r.report_date}`, r]));
    const monthly = new Map<string, { labor: number; transport: number; entries: number; billing: number }>();
    const bump = (ym: string, k: "labor" | "transport" | "entries" | "billing", v: number) => {
      const m = monthly.get(ym) ?? { labor: 0, transport: 0, entries: 0, billing: 0 };
      m[k] += v;
      monthly.set(ym, m);
    };
    const seen = new Set<string>();
    for (const a of d.allocs) {
      const date = a.daily_schedules?.schedule_date as string | undefined;
      if (!date) continue;
      const key = `${a.collaborator_id}|${date}`;
      seen.add(key);
      const r = rdoKey.get(key);
      const hours = r ? (r.present ? Number(r.worked_hours ?? DEFAULT_HOURS) : 0) : DEFAULT_HOURS;
      bump(date.slice(0, 7), "labor", hours * (rate.get(a.collaborator_id) ?? 0) * ENCARGOS);
    }
    for (const r of d.rdoWf) {
      const key = `${r.collaborator_id}|${r.report_date}`;
      if (seen.has(key) || !r.present) continue;
      bump(r.report_date.slice(0, 7), "labor", Number(r.worked_hours ?? 0) * (rate.get(r.collaborator_id) ?? 0) * ENCARGOS);
    }
    const toll = d.client?.has_toll ? Number(d.client.toll_amount ?? 0) : 0;
    for (const v of d.vs) {
      const trips = Number(v.trips ?? 1);
      const cost = Number(v.km ?? 0) * 2 * trips * KM_RATE + toll * 2 * trips;
      bump(v.schedule_date.slice(0, 7), "transport", cost / d.siblingCount);
    }
    for (const e of d.entries) {
      bump(e.entry_date.slice(0, 7), e.category === "faturamento" ? "billing" : "entries", Number(e.amount));
    }
    const progMap = new Map<string, number>(d.progress.map((p: any) => [String(p.month).slice(0, 7), Number(p.percent)]));
    const months = [...new Set([...monthly.keys(), ...progMap.keys()])].sort();
    const order = Number(work.order_value ?? 0);
    const budget = Number(work.budget_cost ?? 0);
    const budgetMarginPct = order ? ((order - budget) / order) * 100 : 0;
    let accCost = 0;
    let lastPct = 0;
    let accBilling = 0;
    const rows = months.map((ym) => {
      const m = monthly.get(ym) ?? { labor: 0, transport: 0, entries: 0, billing: 0 };
      accCost += m.labor + m.transport + m.entries;
      accBilling += m.billing;
      const prev = lastPct;
      if (progMap.has(ym)) lastPct = progMap.get(ym)!;
      const revenue = (order * lastPct) / 100;
      const margin = revenue - accCost;
      const marginPct = revenue ? (margin / revenue) * 100 : 0;
      return {
        ym,
        label: monthLabel(ym),
        progress: lastPct,
        advance: lastPct - prev,
        revenue,
        cost: accCost,
        monthCost: m.labor + m.transport + m.entries,
        labor: m.labor,
        transport: m.transport,
        others: m.entries,
        margin,
        marginPct,
        consumed: budget ? (accCost / budget) * 100 : 0,
        budgetMarginPct,
        billing: accBilling,
      };
    });
    const last = rows[rows.length - 1];
    const tot = { labor: 0, transport: 0, others: 0 };
    rows.forEach((r) => {
      tot.labor += r.labor;
      tot.transport += r.transport;
      tot.others += r.others;
    });
    const real: Record<ItemKey, number> = { mo: tot.labor, transporte: tot.transport, ferramentas: 0, materiais: 0, andaimes: 0 };
    for (const e of d.entries) {
      const k = entryItem(e.category);
      if (k) real[k] += Number(e.amount);
    }
    const bi = ((work as any).budget_items ?? {}) as Record<string, number>;
    const items = ITEMS.map((it) => {
      const b = Number(bi[it.key] ?? 0);
      const r = real[it.key];
      return { label: it.label, budget: b, real: r, used: b ? (r / b) * 100 : r ? 100 : 0 };
    });
    return { rows, last, order, budget, budgetMarginPct, tot, items };
  }, [work, data.data]);

  // ---------- Edição ----------
  const [orderStr, setOrderStr] = useState("");
  const [itemStrs, setItemStrs] = useState<Record<string, string>>({});
  const itemsSum = ITEMS.reduce((a, it) => a + num(itemStrs[it.key] ?? ""), 0);
  const [progMonth, setProgMonth] = useState(new Date().toISOString().slice(0, 7));
  const [progPct, setProgPct] = useState("");
  const [entry, setEntry] = useState({ date: new Date().toISOString().slice(0, 10), category: "materiais", description: "", amount: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["work-result", workId] });
    qc.invalidateQueries({ queryKey: ["works-result"] });
  };

  const saveValues = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("works")
        .update({
          order_value: num(orderStr),
          budget_cost: itemsSum,
          budget_items: Object.fromEntries(ITEMS.map((it) => [it.key, num(itemStrs[it.key] ?? "")])),
        } as any)
        .eq("id", workId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valores salvos");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProgress = useMutation({
    mutationFn: async () => {
      const p = num(progPct);
      if (p < 0 || p > 100) throw new Error("Informe um percentual entre 0 e 100");
      const { error } = await supabase
        .from("work_progress")
        .upsert({ work_id: workId, month: `${progMonth}-01`, percent: p }, { onConflict: "work_id,month" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Andamento salvo");
      setProgPct("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delProgress = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_progress").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveEntry = useMutation({
    mutationFn: async () => {
      const amount = num(entry.amount);
      if (!amount) throw new Error("Informe o valor");
      const { error } = await supabase.from("work_entries").insert({
        work_id: workId,
        entry_date: entry.date,
        category: entry.category,
        description: entry.description.trim() || null,
        amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento salvo");
      setEntry((e) => ({ ...e, description: "", amount: "" }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const selectWork = (id: string) => {
    setWorkId(id);
    const w = works.data?.find((x) => x.id === id);
    const f = (v: unknown) => (Number(v ?? 0) ? Number(v).toFixed(2).replace(".", ",") : "");
    setOrderStr(f(w?.order_value));
    const bi = ((w as any)?.budget_items ?? {}) as Record<string, number>;
    setItemStrs(Object.fromEntries(ITEMS.map((it) => [it.key, f(bi[it.key])])));
  };

  const last = calc?.last;
  const deviation = (last?.marginPct ?? 0) - (calc?.budgetMarginPct ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Resultado da Obra" description="Margem de contribuição proporcional ao andamento do serviço." />

      <div className="max-w-xl">
        <Select value={workId} onValueChange={selectWork}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o serviço" />
          </SelectTrigger>
          <SelectContent>
            {(works.data ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.client ? `${w.client} - ${w.name}` : w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {work && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Orçado x realizado por item</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {calc ? (
                  <ResponsiveContainer>
                    <BarChart data={calc.items} layout="vertical" margin={{ right: 56, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis type="number" fontSize={12} tickFormatter={(v: number) => v.toLocaleString("pt-BR", { notation: "compact" })} />
                      <YAxis type="category" dataKey="label" width={100} fontSize={12} />
                      <Tooltip formatter={(v: number) => brl(v)} />
                      <Legend />
                      <Bar dataKey="budget" name="Orçado" fill="var(--muted-foreground)" />
                      <Bar dataKey="real" name="Realizado" fill="var(--primary)">
                        <LabelList
                          dataKey="used"
                          position="right"
                          fontSize={12}
                          className="fill-foreground"
                          formatter={(v: number) => pct(v)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Orçamento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Valor do pedido (R$)</Label>
                    <Input value={orderStr} onChange={(e) => setOrderStr(e.target.value)} disabled={!canWrite} />
                  </div>
                  {ITEMS.map((it) => (
                    <div key={it.key} className="space-y-1">
                      <Label>{it.label} orçado (R$)</Label>
                      <Input
                        value={itemStrs[it.key] ?? ""}
                        onChange={(e) => setItemStrs((s) => ({ ...s, [it.key]: e.target.value }))}
                        disabled={!canWrite}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Custo total orçado: <span className="font-semibold text-foreground">{brl(itemsSum)}</span>
                  </p>
                  {canWrite && (
                    <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>
                      Salvar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {calc && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Margem de contribuição</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-3">
                <div className="space-y-1 text-sm">
                  <p className="font-semibold uppercase text-muted-foreground">Orçado</p>
                  <Kv k="Valor do pedido" v={brl(calc.order)} />
                  <Kv k="Custo total orçado" v={brl(calc.budget)} />
                  <Kv k="Margem total orçada" v={brl(calc.order - calc.budget)} />
                  <Kv k="Margem %" v={pct(calc.budgetMarginPct)} />
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold uppercase text-muted-foreground">Realizado / proporcional</p>
                  <Kv k="Andamento da obra" v={pct(last?.progress ?? 0)} />
                  <Kv k="Receita proporcional" v={brl(last?.revenue ?? 0)} />
                  <Kv k="Custo realizado" v={brl(last?.cost ?? 0)} />
                  <Kv k="Margem proporcional" v={brl(last?.margin ?? 0)} />
                  <Kv k="Margem %" v={pct(last?.marginPct ?? 0)} />
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold uppercase text-muted-foreground">Comparativos</p>
                  <Kv
                    k="Desvio da margem"
                    v={`${deviation >= 0 ? "+" : ""}${deviation.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p.`}
                    bad={deviation < 0}
                  />
                  <Kv
                    k="Desvio em R$"
                    v={brl((last?.margin ?? 0) - ((last?.revenue ?? 0) * calc.budgetMarginPct) / 100)}
                    bad={deviation < 0}
                  />
                  <Kv k="Obra executada" v={pct(last?.progress ?? 0)} />
                  <Kv k="Orçamento consumido" v={pct(last?.consumed ?? 0)} bad={(last?.consumed ?? 0) > (last?.progress ?? 0)} />
                  <Kv k="Faturado (lançamentos)" v={brl(last?.billing ?? 0)} />
                  <p className="pt-2 text-xs text-muted-foreground">
                    Mão de obra {brl(calc.tot.labor)} · Transporte {brl(calc.tot.transport)} · Lançamentos {brl(calc.tot.others)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {calc && calc.rows.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Andamento x custo x margem</CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer>
                    <ComposedChart data={calc.rows}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis unit="%" fontSize={12} />
                      <Tooltip formatter={(v: number) => pct(v)} />
                      <Legend />
                      <Bar dataKey="progress" name="% andamento" fill="var(--primary)" />
                      <Line dataKey="consumed" name="% orçamento consumido" stroke="var(--foreground)" />
                      <Line dataKey="marginPct" name="% margem proporcional" stroke="var(--chart-2, var(--muted-foreground))" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Margem orçada x margem proporcional realizada</CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer>
                    <ComposedChart data={calc.rows}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis unit="%" fontSize={12} />
                      <Tooltip formatter={(v: number) => pct(v)} />
                      <Legend />
                      <Line dataKey="budgetMarginPct" name="Margem orçada" stroke="var(--muted-foreground)" strokeDasharray="5 5" />
                      <Line dataKey="marginPct" name="Margem realizada" stroke="var(--primary)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {calc && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparativo mensal</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      <TableHead className="text-right">Andamento</TableHead>
                      <TableHead className="text-right">Avanço do mês</TableHead>
                      <TableHead className="text-right">Receita proporcional</TableHead>
                      <TableHead className="text-right">Custo do mês</TableHead>
                      <TableHead className="text-right">Custo acumulado</TableHead>
                      <TableHead className="text-right">Margem proporcional</TableHead>
                      <TableHead className="text-right">Margem %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calc.rows.map((r) => (
                      <TableRow key={r.ym}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right">{pct(r.progress)}</TableCell>
                        <TableCell className="text-right">{pct(r.advance)}</TableCell>
                        <TableCell className="text-right">{brl(r.revenue)}</TableCell>
                        <TableCell className="text-right">{brl(r.monthCost)}</TableCell>
                        <TableCell className="text-right">{brl(r.cost)}</TableCell>
                        <TableCell className={`text-right ${r.margin < 0 ? "text-destructive" : ""}`}>{brl(r.margin)}</TableCell>
                        <TableCell className="text-right">{pct(r.marginPct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Andamento da obra</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label>Mês</Label>
                      <Input type="month" value={progMonth} onChange={(e) => setProgMonth(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>% acumulado</Label>
                      <Input className="w-28" value={progPct} onChange={(e) => setProgPct(e.target.value)} />
                    </div>
                    <Button onClick={() => saveProgress.mutate()} disabled={saveProgress.isPending}>
                      Salvar
                    </Button>
                  </div>
                )}
                <Table>
                  <TableBody>
                    {(data.data?.progress ?? []).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{monthLabel(String(p.month).slice(0, 7))}</TableCell>
                        <TableCell className="text-right">{pct(Number(p.percent))}</TableCell>
                        <TableCell className="w-10">
                          {canWrite && (
                            <Button variant="ghost" size="icon" onClick={() => delProgress.mutate(p.id)} aria-label="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lançamentos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input type="date" className="w-40" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
                    <Select value={entry.category} onValueChange={(v) => setEntry({ ...entry, category: v })}>
                      <SelectTrigger className="w-52">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="min-w-40 flex-1"
                      placeholder="Descrição"
                      value={entry.description}
                      onChange={(e) => setEntry({ ...entry, description: e.target.value })}
                    />
                    <Input
                      className="w-32"
                      placeholder="Valor"
                      value={entry.amount}
                      onChange={(e) => setEntry({ ...entry, amount: e.target.value })}
                    />
                    <Button onClick={() => saveEntry.mutate()} disabled={saveEntry.isPending}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <Table>
                  <TableBody>
                    {(data.data?.entries ?? []).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell>{fmtDate(e.entry_date)}</TableCell>
                        <TableCell>{catLabel(e.category)}</TableCell>
                        <TableCell>{e.description ?? "—"}</TableCell>
                        <TableCell className="text-right">{brl(Number(e.amount))}</TableCell>
                        <TableCell className="w-10">
                          {canWrite && (
                            <Button variant="ghost" size="icon" onClick={() => delEntry.mutate(e.id)} aria-label="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kv({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-medium ${bad ? "text-destructive" : ""}`}>{v}</span>
    </div>
  );
}

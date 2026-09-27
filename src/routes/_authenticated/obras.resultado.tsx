import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";

import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

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
    const perMonth = new Map<string, Record<ItemKey, number>>();
    rows.forEach((r) => perMonth.set(r.ym, { mo: r.labor, transporte: r.transport, ferramentas: 0, materiais: 0, andaimes: 0 }));
    for (const e of d.entries) {
      const k = entryItem(e.category);
      if (!k) continue;
      real[k] += Number(e.amount);
      const pm = perMonth.get(e.entry_date.slice(0, 7));
      if (pm) pm[k] += Number(e.amount);
    }
    const monthBars = rows.map((r) => ({ label: r.label, ...perMonth.get(r.ym)! }));
    const bi = ((work as any).budget_items ?? {}) as Record<string, number>;
    const items = ITEMS.map((it) => {
      const b = Number(bi[it.key] ?? 0);
      const r = real[it.key];
      return { key: it.key, label: it.label, budget: b, real: r, used: b ? (r / b) * 100 : r ? 100 : 0 };
    });
    const dates = [
      ...d.allocs.map((a: any) => a.daily_schedules?.schedule_date).filter(Boolean),
      ...d.rdoWf.map((r: any) => r.report_date),
    ].sort() as string[];
    const first = dates[0];
    const lastDay = dates[dates.length - 1];
    const days = first ? Math.round((Date.parse(lastDay) - Date.parse(first)) / 86400000) + 1 : 0;
    return { rows, last, order, budget, budgetMarginPct, tot, items, monthBars, first, lastDay, days };
  }, [work, data.data]);

  // ---------- Edição ----------
  const [orderStr, setOrderStr] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [quoteNo, setQuoteNo] = useState("");
  const [itemStrs, setItemStrs] = useState<Record<string, string>>({});
  const itemsSum = ITEMS.reduce((a, it) => a + num(itemStrs[it.key] ?? ""), 0);
  const [progMonth, setProgMonth] = useState(new Date().toISOString().slice(0, 7));
  const [progPct, setProgPct] = useState("");
  const [entry, setEntry] = useState({ date: new Date().toISOString().slice(0, 10), category: "materiais", description: "", amount: "" });
  const [dlg, setDlg] = useState<null | "cliente" | "orcamento" | "andamento" | "lancamentos">(null);

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
          order_number: orderNo.trim() || null,
          quote_number: quoteNo.trim() || null,
          budget_cost: itemsSum,
          budget_items: Object.fromEntries(ITEMS.map((it) => [it.key, num(itemStrs[it.key] ?? "")])),
        } as any)
        .eq("id", workId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valores salvos");
      setDlg(null);
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
    const w = works.data?.find((x) => x.id === id) as any;
    const f = (v: unknown) => (Number(v ?? 0) ? Number(v).toFixed(2).replace(".", ",") : "");
    setOrderStr(f(w?.order_value));
    setOrderNo(w?.order_number ?? "");
    setQuoteNo(w?.quote_number ?? "");
    const bi = (w?.budget_items ?? {}) as Record<string, number>;
    setItemStrs(Object.fromEntries(ITEMS.map((it) => [it.key, f(bi[it.key])])));
  };

  const last = calc?.last;
  const billed = last?.billing ?? 0;
  const order = calc?.order ?? 0;
  const budgetMargin = order - (calc?.budget ?? 0);
  const realMargin = (last?.revenue ?? 0) - (last?.cost ?? 0);
  const totBudget = calc?.items.reduce((a, i) => a + i.budget, 0) ?? 0;
  const totReal = calc?.items.reduce((a, i) => a + i.real, 0) ?? 0;
  const barItems = (calc?.items ?? []).filter((i) => i.budget || i.real);
  const open = (k: NonNullable<typeof dlg>) => canWrite && setDlg(k);
  const clickable = canWrite ? "cursor-pointer rounded-md transition-colors hover:bg-muted/60" : "";
  const w = work as any;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xl">
          <Select value={workId} onValueChange={selectWork}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o serviço" />
            </SelectTrigger>
            <SelectContent>
              {(works.data ?? []).map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.client ? `${x.client} - ${x.name}` : x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {work && canWrite && (
          <Button variant="outline" onClick={() => setDlg("lancamentos")}>
            Lançamentos
          </Button>
        )}
      </div>

      {!work && <p className="text-sm text-muted-foreground">Selecione um serviço para ver o relatório financeiro.</p>}

      {work && (
        <div className="rounded-lg border bg-card px-8 py-6 shadow-sm">
          {/* Cabeçalho */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 border-b pb-4">
            <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-6 gap-y-1 text-sm justify-self-start">
              <span className="text-muted-foreground">Primeiro Dia:</span>
              <span className="font-semibold">{calc?.first ? fmtDate(calc.first) : "—"}</span>
              <span className="text-muted-foreground">Dias Totais</span>
              <span />
              <span className="text-muted-foreground">Último Dia:</span>
              <span className="font-semibold">{calc?.lastDay ? fmtDate(calc.lastDay) : "—"}</span>
              <span className="font-semibold">{calc?.days ?? 0}</span>
              <span />
            </div>
            <h1 className="text-center text-3xl font-bold italic tracking-wide">RELATÓRIO FINANCEIRO DE OBRAS</h1>
            <div className="flex items-center gap-4 justify-self-end">
              <span className="font-display text-3xl font-black italic text-primary">AB5</span>
              <div className="text-sm">
                <p className="text-muted-foreground">Atualização</p>
                <p className="font-semibold">{fmtDate(new Date().toISOString().slice(0, 10))}</p>
              </div>
            </div>
          </div>

          {/* Linha 1 */}
          <div className="grid gap-6 border-b py-5 xl:grid-cols-[1fr_2fr_1fr]">
            <div className={`p-3 ${clickable}`} onClick={() => open("cliente")} title={canWrite ? "Clique para editar" : undefined}>
              <SectionTitle>Dados do Cliente</SectionTitle>
              <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <Lbl>Cliente</Lbl>
                <span className="text-lg font-bold">{w.client ?? "—"}</span>
                <Lbl>Obra</Lbl>
                <span className="text-xs uppercase">{w.name}</span>
                <Lbl>Nº Pedido</Lbl>
                <span>{w.order_number || "—"}</span>
                <Lbl>Nº Orç. AB5</Lbl>
                <span className="flex justify-between">
                  <span>{w.quote_number || "—"}</span>
                  <span>{order ? `${Math.round((billed / order) * 100)}%` : ""}</span>
                </span>
                <Lbl>Valor Faturado</Lbl>
                <span>{brl(billed)}</span>
                <Lbl>Saldo a Faturar</Lbl>
                <span>{brl(order - billed)}</span>
              </div>
              <div className="mt-6 text-center">
                <SectionTitle>Valor do Pedido</SectionTitle>
                <p className="mt-2 text-xl font-bold">{brl(order)}</p>
              </div>
            </div>

            <div>
              <SectionTitle>Andamento Mensal</SectionTitle>
              <div className="mt-2 h-64">
                {calc && calc.monthBars.length > 0 ? (
                  <ResponsiveContainer>
                    <BarChart data={calc.monthBars} margin={{ left: 20 }}>
                      <CartesianGrid vertical={false} className="stroke-border" />
                      <XAxis dataKey="label" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={(v: number) => brl(v)} width={100} />
                      <Tooltip formatter={(v: number) => brl(v)} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="mo" name="R$ Total MO" fill="var(--muted-foreground)" />
                      <Bar dataKey="materiais" name="R$ Total Materiais" fill="var(--primary)" />
                      <Bar dataKey="transporte" name="R$ Total Transporte" fill="var(--foreground)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="pt-10 text-center text-sm text-muted-foreground">Sem custos lançados.</p>
                )}
              </div>
            </div>

            <div className={`p-3 ${clickable}`} onClick={() => open("andamento")} title={canWrite ? "Clique para lançar o andamento" : undefined}>
              <SectionTitle>Conclusão da Obra</SectionTitle>
              <Gauge value={last?.progress ?? 0} />
            </div>
          </div>

          {/* Linha 2 */}
          <div className="grid gap-6 pt-5 xl:grid-cols-[1fr_2fr_1fr]">
            <div className="h-64">
              {barItems.length ? (
                <ResponsiveContainer>
                  <BarChart data={barItems} layout="vertical" margin={{ right: 48 }} barGap={2}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={80} fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number) => brl(v)} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="real" name="Custo Realizado" fill="var(--primary)">
                      <LabelList dataKey="used" position="right" fontSize={11} className="fill-foreground" formatter={(v: number) => pct(Math.round(v))} />
                    </Bar>
                    <Bar dataKey="budget" name="Custo Orçado" fill="var(--muted-foreground)" fillOpacity={0.45} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-10 text-center text-sm text-muted-foreground">Sem orçamento por item.</p>
              )}
            </div>

            <div className={`p-3 ${clickable}`} onClick={() => open("orcamento")} title={canWrite ? "Clique para editar o orçado" : undefined}>
              <SectionTitle>Custos Orçados x Realizado</SectionTitle>
              <table className="mx-auto mt-4 w-full max-w-2xl text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground italic">
                    <th className="py-1 text-left font-normal">Tipo de Custo</th>
                    <th className="text-right font-normal">Custo Orçado</th>
                    <th className="text-right font-normal">Custo Realizado</th>
                    <th className="text-right font-normal">% Utilizado</th>
                  </tr>
                </thead>
                <tbody>
                  {(calc?.items ?? []).map((i) => (
                    <tr key={i.key}>
                      <td className="py-1 pl-3">{i.label}</td>
                      <td className="text-right">{brl(i.budget)}</td>
                      <td className="text-right">{brl(i.real)}</td>
                      <td className={`text-right ${i.used > 100 ? "text-destructive" : ""}`}>{Math.round(i.used)}%</td>
                    </tr>
                  ))}
                  <tr className="font-bold italic">
                    <td className="py-1">Total</td>
                    <td className="text-right">{brl(totBudget)}</td>
                    <td className="text-right">{brl(totReal)}</td>
                    <td className="text-right">{totBudget ? Math.round((totReal / totBudget) * 100) : 0}%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3">
              <SectionTitle>Margem de Contribuição</SectionTitle>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] text-center">
                <p className="border-b pb-1 text-sm italic text-muted-foreground">Orçado</p>
                <p className="border-b pb-1 text-sm font-bold text-primary">% | %</p>
                <p className="border-b pb-1 text-sm italic text-muted-foreground">Realizado</p>
                <p className="pt-6 text-sm">{brl(budgetMargin)}</p>
                <div className="row-span-2 mx-4 w-px bg-border" />
                <p className={`pt-6 text-sm ${realMargin < 0 ? "text-destructive" : ""}`}>{brl(realMargin)}</p>
                <p className="pt-4 text-lg">{pct(calc?.budgetMarginPct ?? 0)}</p>
                <p className={`pt-4 text-lg ${(last?.marginPct ?? 0) < 0 ? "text-destructive" : ""}`}>{pct(last?.marginPct ?? 0)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diálogos */}
      <Dialog open={dlg === "cliente"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados do cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Nº Pedido" value={orderNo} onChange={setOrderNo} />
            <Field label="Nº Orç. AB5" value={quoteNo} onChange={setQuoteNo} />
            <Field label="Valor do pedido (R$)" value={orderStr} onChange={setOrderStr} />
            <p className="text-xs text-muted-foreground">O valor faturado vem dos lançamentos de Faturamento.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "orcamento"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custos orçados</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {ITEMS.map((it) => (
              <Field
                key={it.key}
                label={`${it.label} (R$)`}
                value={itemStrs[it.key] ?? ""}
                onChange={(v) => setItemStrs((s) => ({ ...s, [it.key]: v }))}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Total orçado: <span className="font-semibold text-foreground">{brl(itemsSum)}</span>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg("lancamentos")}>Lançar custo realizado</Button>
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "andamento"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Andamento da obra</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Mês</Label>
              <Input type="month" value={progMonth} onChange={(e) => setProgMonth(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>% acumulado</Label>
              <Input className="w-28" value={progPct} onChange={(e) => setProgPct(e.target.value)} />
            </div>
            <Button onClick={() => saveProgress.mutate()} disabled={saveProgress.isPending}>Salvar</Button>
          </div>
          <Table>
            <TableBody>
              {(data.data?.progress ?? []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{monthLabel(String(p.month).slice(0, 7))}</TableCell>
                  <TableCell className="text-right">{pct(Number(p.percent))}</TableCell>
                  <TableCell className="w-10">
                    <Button variant="ghost" size="icon" onClick={() => delProgress.mutate(p.id)} aria-label="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "lancamentos"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lançamentos</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" className="w-40" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
            <Select value={entry.category} onValueChange={(v) => setEntry({ ...entry, category: v })}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="min-w-40 flex-1" placeholder="Descrição" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
            <Input className="w-32" placeholder="Valor" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
            <Button onClick={() => saveEntry.mutate()} disabled={saveEntry.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableBody>
                {(data.data?.entries ?? []).map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell>{fmtDate(e.entry_date)}</TableCell>
                    <TableCell>{catLabel(e.category)}</TableCell>
                    <TableCell>{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(Number(e.amount))}</TableCell>
                    <TableCell className="w-10">
                      <Button variant="ghost" size="icon" onClick={() => delEntry.mutate(e.id)} aria-label="Excluir">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-sm font-semibold uppercase italic text-muted-foreground">{children}</p>;
}
function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold italic text-muted-foreground">{children}</span>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Velocímetro semicircular com faixas e ponteiro. */
function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const cx = 120, cy = 120, R = 100, r = 70;
  const pt = (p: number, rad: number) => {
    const a = Math.PI * (1 - p / 100);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const seg = (a: number, b: number) => {
    const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R), [x3, y3] = pt(b, r), [x4, y4] = pt(a, r);
    return `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 0 0 ${x4},${y4} Z`;
  };
  const bands = [0, 20, 40, 60, 80, 100];
  const [nx, ny] = pt(v, R - 4);
  const [bx1, by1] = pt(v + 50, 5);
  const [bx2, by2] = pt(v - 50, 5);
  return (
    <div className="mt-2 flex flex-col items-center">
      <svg viewBox="0 0 240 135" className="w-full max-w-xs">
        {bands.slice(0, -1).map((b, i) => (
          <path key={b} d={seg(b, bands[i + 1])} fill="var(--primary)" fillOpacity={0.15 + i * 0.2} />
        ))}
        <polygon points={`${nx},${ny} ${bx1},${by1} ${bx2},${by2}`} fill="var(--muted-foreground)" />
        <circle cx={cx} cy={cy} r={5} fill="var(--muted-foreground)" />
      </svg>
      <p className="text-2xl font-bold">{pct(v)}</p>
    </div>
  );
}

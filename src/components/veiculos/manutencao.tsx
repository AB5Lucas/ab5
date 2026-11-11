import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAll, loadResultShared } from "@/lib/results-engine";
import { BUDGET_KM_RATE, dayKm, dayToll, normalizePlate, vehicleMonth, type VehicleMonth } from "@/lib/fleet-costs";
import { budgetByClient, serviceTransportBudget, type BudgetPart } from "@/lib/fleet-budget";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { syncFleetCostsNow } from "@/lib/fleet-costs.functions";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(v));
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

type Vehicle = { id: string; plate: string; model: string | null; type: string | null; ownership: string; monthly_rent: number };
type Row = VehicleMonth & { id: string; plate: string; label: string; ownership: string };

/** Transporte › Custos: orçado (km × R$ 1,35 + pedágio) contra o gasto real de cada veículo. */
export function FleetMaintenancePage() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const first = addMonths(month, -11);
  const from = `${first}-01`, to = lastDay(month);

  const vehicles = useQuery({
    queryKey: ["fleet-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, plate, model, type, ownership, monthly_rent").order("plate");
      if (error) throw error;
      return (data ?? []) as Vehicle[];
    },
  });
  const schedules = useQuery({
    queryKey: ["fleet-schedules", from, to],
    queryFn: () => fetchAll<any>((a, b) => supabase.from("vehicle_schedules")
      .select("vehicle_id, schedule_date, km, trips, extra_km, is_suzano_local, is_maintenance, clients(has_toll, toll_amount)")
      .gte("schedule_date", from).lte("schedule_date", to).order("id").range(a, b)),
  });
  const expenses = useQuery({
    queryKey: ["fleet-expenses", from, to],
    queryFn: () => fetchAll<any>((a, b) => supabase.from("fleet_expenses").select("source, plate, expense_date, amount")
      .gte("expense_date", from).lte("expense_date", to).order("id").range(a, b)),
  });
  /** Transporte orçado dos serviços: mesmo carregamento em lote do Financeiro (dados dos Resultados). */
  const allWorks = useQuery({
    queryKey: ["fin-works"],
    queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [],
  });
  const holidays = useQuery({
    queryKey: ["holidays-dates"],
    queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string),
  });
  const active = useQuery({ queryKey: ["fin-active", from, to], queryFn: () => loadFinanceActive(from, to) });
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const serviceList = useMemo(() => financeList(allWorks.data ?? [], active.data, from, to), [allWorks.data, active.data, from, to]);
  const batches = useMemo(() => financeBatches(serviceList), [serviceList]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey],
    staleTime: 60_000,
    enabled: !!shared.data && !!active.data,
    queryFn: () => loadFinanceRaws(batches, shared.data!),
  });
  const files = useQuery({
    queryKey: ["fleet-expense-files"],
    queryFn: async () => (await supabase.from("fleet_expense_files").select("file_path, source, rows, synced_at").order("synced_at", { ascending: false })).data ?? [],
  });

  const syncFn = useServerFn(syncFleetCostsNow);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (res) => {
      const failed = res.filter((r) => r.error);
      if (failed.length) toast.error(`Falha ao ler: ${failed.map((f) => `${f.file.split("/").pop()} (${f.error})`).join("; ")}`);
      else toast.success(`Planilhas lidas: ${res.map((r) => `${r.file.split("/").pop()} ${r.rows} linhas`).join(" · ")}`);
      qc.invalidateQueries({ queryKey: ["fleet-expenses"] });
      qc.invalidateQueries({ queryKey: ["fleet-expense-files"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveRent = useMutation({
    mutationFn: async (v: { id: string; ownership: string; monthly_rent: number }) => {
      const { error } = await supabase.from("vehicles").update({ ownership: v.ownership, monthly_rent: v.ownership === "alugado" ? v.monthly_rent : 0 }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet-vehicles"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  /** Placa normalizada → veículo; usada para casar os gastos das planilhas com o cadastro. */
  const byPlate = useMemo(() => new Map((vehicles.data ?? []).map((v) => [normalizePlate(v.plate), v])), [vehicles.data]);

  /** Totais por veículo e mês (12 meses até o mês escolhido). */
  const table = useMemo(() => {
    const acc = new Map<string, { km: number; toll: number; fuel: number; maintenance: number }>();
    const get = (vid: string, ym: string) => {
      const k = `${vid}|${ym}`;
      let e = acc.get(k);
      if (!e) acc.set(k, (e = { km: 0, toll: 0, fuel: 0, maintenance: 0 }));
      return e;
    };
    for (const s of schedules.data ?? []) {
      if (s.is_maintenance) continue;
      const e = get(s.vehicle_id, s.schedule_date.slice(0, 7));
      e.km += dayKm(s);
      e.toll += dayToll(s);
    }
    const unmatched = new Map<string, { fuel: number; maintenance: number }>();
    for (const x of expenses.data ?? []) {
      const ym = x.expense_date.slice(0, 7);
      const v = byPlate.get(x.plate);
      if (!v) {
        if (ym === month) {
          const u = unmatched.get(x.plate) ?? { fuel: 0, maintenance: 0 };
          u[x.source === "combustivel" ? "fuel" : "maintenance"] += Number(x.amount);
          unmatched.set(x.plate, u);
        }
        continue;
      }
      get(v.id, ym)[x.source === "combustivel" ? "fuel" : "maintenance"] += Number(x.amount);
    }
    const kmByMonth = new Map<string, number>();
    for (const [k, e] of acc) kmByMonth.set(k.split("|")[1]!, (kmByMonth.get(k.split("|")[1]!) ?? 0) + e.km);
    return { acc, unmatched, kmByMonth };
  }, [schedules.data, expenses.data, byPlate, month]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(first, i)), [first]);
  /** Orçado de transporte da frota por mês: soma dos serviços (mensal inteiro; demais pelo andamento do mês). */
  const budgetParts = useMemo(() => {
    const out = new Map<string, BudgetPart[]>();
    if (!raws.data) return out;
    const opts = { holidays: holidays.data ?? [], allWorks: allWorks.data ?? [] };
    for (const ym of months) {
      const parts: BudgetPart[] = [];
      for (const w of serviceList) {
        const raw = raws.data.get(w.id);
        const p = raw ? serviceTransportBudget(w, raw, ym, opts) : null;
        if (p) parts.push(p);
      }
      out.set(ym, parts.sort((a, b) => b.value - a.value));
    }
    return out;
  }, [raws.data, serviceList, months, holidays.data, allWorks.data]);
  const fleetBudget = useMemo(
    () => new Map([...budgetParts].map(([ym, parts]) => [ym, Math.round(parts.reduce((s, p) => s + p.value, 0) * 100) / 100])),
    [budgetParts],
  );
  const [showBudget, setShowBudget] = useState(false);

  /** O orçado da frota no mês é dividido entre os veículos pelo km rodado de cada um. */
  const rowFor = (v: Vehicle, ym: string): Row => {
    const e = table.acc.get(`${v.id}|${ym}`) ?? { km: 0, toll: 0, fuel: 0, maintenance: 0 };
    const rent = v.ownership === "alugado" ? Number(v.monthly_rent ?? 0) : 0;
    const kmAll = table.kmByMonth.get(ym) ?? 0;
    const budget = kmAll ? ((fleetBudget.get(ym) ?? 0) * e.km) / kmAll : 0;
    return { ...vehicleMonth(Math.round(e.km * 10) / 10, budget, e.toll, e.fuel, e.maintenance, rent), id: v.id, plate: v.plate, label: `${v.plate}${v.model ? ` · ${v.model}` : ""}`, ownership: v.ownership };
  };

  const shownVehicles = (vehicles.data ?? []).filter((v) => vehicleFilter === "all" || v.id === vehicleFilter);
  const rows = shownVehicles.map((v) => rowFor(v, month)).filter((r) => r.km || r.real).sort((a, b) => b.real - a.real || a.plate.localeCompare(b.plate));
  const sumRows = (rs: Row[]) => rs.reduce((t, r) => ({ km: t.km + r.km, kmCost: t.kmCost + r.kmCost, budget: t.budget + r.budget, real: t.real + r.real, fuel: t.fuel + r.fuel, maintenance: t.maintenance + r.maintenance, toll: t.toll + r.toll, rent: t.rent + r.rent }), { km: 0, kmCost: 0, budget: 0, real: 0, fuel: 0, maintenance: 0, toll: 0, rent: 0 });
  const total = sumRows(rows);
  // Frota inteira: o orçado é o total dos serviços, mesmo que nenhum veículo tenha rodado.
  if (vehicleFilter === "all") total.budget = fleetBudget.get(month) ?? 0;
  const diff = total.budget - total.real;
  const trend = months.map((ym) => {
    const t = sumRows(shownVehicles.map((v) => rowFor(v, ym)));
    return { label: monthLabel(ym), Orçado: Math.round(vehicleFilter === "all" ? fleetBudget.get(ym) ?? 0 : t.budget), Real: Math.round(t.real), "Km × 1,35": Math.round(t.kmCost) };
  });
  const unmatched = [...table.unmatched].map(([plate, u]) => ({ plate, ...u })).sort((a, b) => b.fuel + b.maintenance - (a.fuel + a.maintenance));
  const unmatchedTotal = unmatched.reduce((s, u) => s + u.fuel + u.maintenance, 0);
  const loading = vehicles.isLoading || schedules.isLoading || expenses.isLoading;
  const budgetLoading = allWorks.isLoading || active.isLoading || shared.isLoading || (serviceList.length > 0 && raws.isPending);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Custos"
        description={`Orçado: soma do transporte orçado dos serviços no mês (mensais: o mês inteiro; demais: pelo andamento do mês; Indústria, ADM, Comercial e Pátio ou sem orçado lançado: o custo real dos veículos, km e pedágio, sem VT), dividida entre os veículos pelo km. Clique no Orçado para ver o detalhe. Real: combustível (planilha do posto) + manutenção (planilha do Romildo) + pedágio + locação. Km × ${brl(BUDGET_KM_RATE)} fica só como referência.`}
        actions={
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} /> {sync.isPending ? "Lendo planilhas..." : "Atualizar planilhas"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="fleet-month">Mês</Label>
          <Input id="fleet-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Veículo</Label>
          <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os veículos</SelectItem>
              {(vehicles.data ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}{v.model ? ` · ${v.model}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          {files.data?.length
            ? `Planilhas lidas em ${new Date(files.data[0]!.synced_at).toLocaleString("pt-BR")} (atualiza sozinho todo dia).`
            : "As planilhas ainda não foram lidas: clique em Atualizar planilhas."}
        </p>
        {loading && <span className="pb-2 text-sm text-muted-foreground">Carregando...</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Km rodados" value={total.km.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} />
        <Kpi label="Orçado" value={budgetLoading ? "Calculando..." : brl(total.budget)} hint="clique para ver o que compõe" onClick={budgetLoading ? undefined : () => setShowBudget(true)} />
        <Kpi label="Real" value={brl(total.real)} />
        <Kpi label="Diferença" value={`${diff < 0 ? "−" : "+"} ${brl(Math.abs(diff))}`} tone={diff < 0 ? "bad" : "good"} hint={total.budget ? `${diff < 0 ? "acima" : "abaixo"} do orçado em ${Math.abs((diff / total.budget) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : undefined} />
        <Kpi label="Custo real por km" value={total.km ? brl(total.real / total.km) : "—"} hint={`referência ${brl(BUDGET_KM_RATE)} por km`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi small label="Combustível" value={brl(total.fuel)} />
        <Kpi small label="Manutenção" value={brl(total.maintenance)} />
        <Kpi small label="Pedágio" value={brl(total.toll)} />
        <Kpi small label="Locação" value={brl(total.rent)} />
        <Kpi small label={`Km × ${brl(BUDGET_KM_RATE)} (referência)`} value={brl(total.kmCost)} hint="informativo, não entra no orçado" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel p-4">
          <h3 className="mb-2 text-sm font-medium">Orçado × real por veículo · {monthLabel(month)}</h3>
          {rows.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rows} margin={{ left: 8, right: 16, bottom: 8 }} barGap={2} barCategoryGap="20%">
                <CartesianGrid vertical={false} className="stroke-border" />
                <XAxis dataKey="plate" fontSize={10} interval={0} angle={-40} textAnchor="end" height={52} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v: number) => brlShort(v)} width={80} />
                <Tooltip formatter={(v: number) => brl(v)} labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
                <Bar dataKey="budget" name="Orçado" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="real" name="Real" fill="var(--chart-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="kmCost" name={`Km × ${brl(BUDGET_KM_RATE)}`} fill="var(--muted-foreground)" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">Sem km nem gastos neste mês.</p>}
        </section>
        <section className="panel p-4">
          <h3 className="mb-2 text-sm font-medium">Orçado × real nos últimos 12 meses{vehicleFilter !== "all" ? ` · ${shownVehicles[0]?.plate ?? ""}` : ""}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trend} margin={{ left: 8, right: 16 }}>
              <CartesianGrid vertical={false} className="stroke-border" />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v: number) => brlShort(v)} width={80} />
              <Tooltip formatter={(v: number) => brl(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
              <Line type="monotone" dataKey="Orçado" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Real" stroke="var(--chart-blue)" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Km × 1,35" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">Km × 1,35 (tracejado) é referência; só existe a partir do mês em que a programação de veículos passou a ser lançada no sistema.</p>
        </section>
      </div>

      {unmatchedTotal > 0 && (
        <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Gastos de {monthLabel(month)} com placa que não está no cadastro de veículos: <b>{brl(unmatchedTotal)}</b> ({unmatched.map((u) => `${u.plate} ${brl(u.fuel + u.maintenance)}`).join(" · ")}). Cadastre o veículo na Frota ou corrija a placa na planilha.
          </p>
        </div>
      )}

      <div className="panel overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Veículo</TableHead>
              <TableHead className="text-right">Km</TableHead>
              <TableHead className="text-right">Km × 1,35</TableHead>
              <TableHead className="text-right">Orçado</TableHead>
              <TableHead className="text-right">Combustível</TableHead>
              <TableHead className="text-right">Manutenção</TableHead>
              <TableHead className="text-right">Pedágio</TableHead>
              <TableHead className="text-right">Locação</TableHead>
              <TableHead className="text-right">Real</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
              <TableHead className="text-right">R$/km real</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap font-medium">{r.label}{r.ownership === "alugado" && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">Alugado</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{r.km ? r.km.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{r.kmCost ? brl(r.kmCost) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.budget ? brl(r.budget) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.fuel ? brl(r.fuel) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.maintenance ? brl(r.maintenance) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.toll ? brl(r.toll) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rent ? brl(r.rent) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(r.real)}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.diff < 0 ? "text-destructive" : "text-emerald-600"}`}>{r.diff < 0 ? "−" : "+"} {brl(Math.abs(r.diff))}</TableCell>
                <TableCell className="text-right tabular-nums">{r.km ? brl(r.real / r.km) : "—"}</TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground">Nenhum veículo rodou ou teve gasto neste mês.</TableCell></TableRow>
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{total.km.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{brl(total.kmCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.budget)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.fuel)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.maintenance)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.toll)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.rent)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(total.real)}</TableCell>
                <TableCell className={`text-right tabular-nums ${diff < 0 ? "text-destructive" : "text-emerald-600"}`}>{diff < 0 ? "−" : "+"} {brl(Math.abs(diff))}</TableCell>
                <TableCell className="text-right tabular-nums">{total.km ? brl(total.real / total.km) : "—"}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <Dialog open={showBudget} onOpenChange={setShowBudget}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Orçado de transporte · {monthLabel(month)}</DialogTitle>
            <DialogDescription>
              Todos os clientes com atividade no mês: {brl(fleetBudget.get(month) ?? 0)}. Por serviço: orçado lançado (mensal pelo BDI dos pedidos do mês; demais pelo andamento); Indústria, ADM, Comercial e Pátio ou sem orçado lançado: custo real dos veículos (km e pedágio), sem VT.
              {vehicleFilter !== "all" ? ` O veículo filtrado recebe ${brl(total.budget)}, a parte proporcional ao km dele.` : " Entre os veículos, o valor é dividido pelo km rodado."}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente / serviço</TableHead>
                <TableHead>Como foi calculado</TableHead>
                <TableHead>Base</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgetByClient(budgetParts.get(month) ?? []).map((c) => (
                <Fragment key={c.key}>
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-medium">{c.client}</TableCell>
                    <TableCell className="text-xs">{c.rules.join(" + ")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.parts.length} serviço(s)</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{brl(c.value)}</TableCell>
                  </TableRow>
                  {c.parts.map((p) => (
                    <TableRow key={p.workId}>
                      <TableCell className="pl-6 text-sm text-muted-foreground">{p.service}</TableCell>
                      <TableCell className="text-xs">{p.rule}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{p.base}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{brl(p.value)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
              {!(budgetParts.get(month) ?? []).length && (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Nenhum cliente com atividade neste mês.</TableCell></TableRow>
              )}
            </TableBody>
            {(budgetParts.get(month) ?? []).length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(fleetBudget.get(month) ?? 0)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </DialogContent>
      </Dialog>

      <section className="panel space-y-3 p-4">
        <div>
          <h3 className="text-sm font-medium">Locação</h3>
          <p className="text-xs text-muted-foreground">Marque se cada veículo é próprio ou alugado. No alugado, o valor mensal entra no real de todos os meses.</p>
        </div>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {(vehicles.data ?? []).map((v) => <RentRow key={v.id} v={v} disabled={!canWrite || saveRent.isPending} onSave={(o, rent) => saveRent.mutate({ id: v.id, ownership: o, monthly_rent: rent })} />)}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, hint, tone, small, onClick }: { label: string; value: string; hint?: string | undefined; tone?: "good" | "bad"; small?: boolean; onClick?: (() => void) | undefined }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${small ? "text-base" : "font-display text-xl"} tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-emerald-600" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="panel p-3 text-left transition hover:ring-2 hover:ring-primary/40">{body}</button>
  ) : (
    <div className="panel p-3">{body}</div>
  );
}

function RentRow({ v, disabled, onSave }: { v: Vehicle; disabled: boolean; onSave: (ownership: string, rent: number) => void }) {
  const [value, setValue] = useState(v.monthly_rent ? String(v.monthly_rent).replace(".", ",") : "");
  const parse = (s: string) => { const n = Number(s.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate"><b className="font-medium">{v.plate}</b>{v.model ? <span className="text-muted-foreground"> · {v.model}</span> : null}</span>
      <Select value={v.ownership} disabled={disabled} onValueChange={(o) => onSave(o, parse(value))}>
        <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Próprio ou alugado: ${v.plate}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="proprio">Próprio</SelectItem>
          <SelectItem value="alugado">Alugado</SelectItem>
        </SelectContent>
      </Select>
      {v.ownership === "alugado" ? (
        <Input
          className="h-8 w-32 text-xs"
          inputMode="decimal"
          placeholder="R$ por mês"
          aria-label={`Locação mensal de ${v.plate}`}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => parse(value) !== Number(v.monthly_rent ?? 0) && onSave("alugado", parse(value))}
        />
      ) : <span className="w-32" />}
    </div>
  );
}

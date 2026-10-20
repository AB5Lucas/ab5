import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


const km = (v: number) => v.toLocaleString("pt-BR");

function firstDayOfMonth() {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function FleetReportsPage() {
  const [start, setStart] = useState(firstDayOfMonth);
  const [end, setEnd] = useState(today);
  const [search, setSearch] = useState("");

  const vehicles = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("plate");
      if (error) throw error;
      return data;
    },
  });

  const report = useQuery({
    queryKey: ["km-report", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_schedules")
        .select("vehicle_id, schedule_date, is_external, km, extra_km, trips")
        .gte("schedule_date", start)
        .lte("schedule_date", end);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const totals = new Map<string, { work: number; external: number; today: number; month: number }>();
    const monthPrefix = today().slice(0, 7);
    for (const r of report.data ?? []) {
      const entry = totals.get(r.vehicle_id) ?? { work: 0, external: 0, today: 0, month: 0 };
      const value = (Number(r.km ?? 0) * Math.max(1, Number(r.trips ?? 1) || 1) + Number(r.extra_km ?? 0)) * 2; // ida e volta, somando obras adicionais
      if (r.is_external) entry.external += value;
      else entry.work += value;
      if (r.schedule_date === today()) entry.today += value;
      if (r.schedule_date.slice(0, 7) === monthPrefix) entry.month += value;
      totals.set(r.vehicle_id, entry);
    }
    const q = search.trim().toLowerCase();
    return (vehicles.data ?? [])
      .filter((v) => !q || [v.plate, v.model, v.brand].filter(Boolean).some((x) => String(x).toLowerCase().includes(q)))
      .map((v) => {
        const t = totals.get(v.id) ?? { work: 0, external: 0, today: 0, month: 0 };
        return {
          id: v.id,
          vehicle: [v.brand, v.model].filter(Boolean).join(" ") || "Veículo",
          model: v.model ?? "—",
          plate: v.plate,
          ...t,
          total: t.work + t.external,
        };
      });
  }, [vehicles.data, report.data, search]);

  const fleet = rows.reduce(
    (acc, r) => ({ work: acc.work + r.work, external: acc.external + r.external, total: acc.total + r.total }),
    { work: 0, external: 0, total: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios da Frota"
        description="Quilometragem calculada automaticamente pela programação de transporte (ida e volta: KM de ida da obra × 2; Indústria 100 km/dia, Externo 200 km/dia)."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Início</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-44" />
        </div>
        <div>
          <Label>Fim</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-44" />
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por veículo, modelo ou placa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">KM de obras</p>
          <p className="font-display text-xl font-semibold">{km(fleet.work)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">KM externo</p>
          <p className="font-display text-xl font-semibold">{km(fleet.external)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">KM total da frota</p>
          <p className="font-display text-xl font-semibold">{km(fleet.total)}</p>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Veículo</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead className="text-right">KM no dia</TableHead>
              <TableHead className="text-right">KM no mês</TableHead>
              <TableHead className="text-right">KM obras</TableHead>
              <TableHead className="text-right">KM externo</TableHead>
              <TableHead className="text-right">KM no período</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.isLoading && (
              <TableRow><TableCell colSpan={8}>Carregando...</TableCell></TableRow>
            )}
            {!report.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">Nenhum veículo encontrado.</TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.vehicle}</TableCell>
                <TableCell>{r.model}</TableCell>
                <TableCell className="font-mono text-xs uppercase">{r.plate}</TableCell>
                <TableCell className="text-right">{km(r.today)}</TableCell>
                <TableCell className="text-right">{km(r.month)}</TableCell>
                <TableCell className="text-right">{km(r.work)}</TableCell>
                <TableCell className="text-right">{km(r.external)}</TableCell>
                <TableCell className="text-right font-medium">{km(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

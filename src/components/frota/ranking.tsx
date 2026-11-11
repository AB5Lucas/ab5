import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAll } from "@/lib/results-engine";
import { normalizePlate } from "@/lib/fleet-costs";
import { driverRanking, NOTE_GRACE_DAYS, type RankingNote, type RankingSchedule } from "@/lib/fleet-notes";

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const addMonthsYm = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const scoreTone = (s: number) => (s >= 90 ? "bg-emerald-600" : s >= 70 ? "bg-amber-500" : "bg-destructive");

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

/** Frota › Abastecimento › Ranking: motoristas pela entrega da foto da nota (motorista pela Transporte). */
export function DriverRanking() {
  const [until, setUntil] = useState(() => new Date().toISOString().slice(0, 7));
  const [months, setMonths] = useState("1");
  const [open, setOpen] = useState<string | null>(null);
  const fromYm = addMonthsYm(until, 1 - Number(months));
  const today = new Date().toISOString().slice(0, 10);

  const notes = useQuery({
    queryKey: ["fleet-ranking-notes", fromYm, until],
    queryFn: () => fetchAll<RankingNote>((a, b) => supabase.from("fleet_fuel_notes")
      .select("id, nf_number, issued_at, plate, plate_fix, driver, driver_fix, total, note_file")
      .gte("ref_month", fromYm).lte("ref_month", until).order("issued_at").range(a, b)),
  });
  const schedules = useQuery({
    queryKey: ["fleet-ranking-schedules", fromYm, until],
    queryFn: () => fetchAll<RankingSchedule>((a, b) => supabase.from("vehicle_schedules").select("vehicle_id, schedule_date, driver_id, extra_driver_ids")
      .gte("schedule_date", addDays(`${fromYm}-01`, -1)).lte("schedule_date", lastDay(until)).order("schedule_date").range(a, b)),
  });
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-basic"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model").order("plate")).data ?? [] });
  const names = useQuery({ queryKey: ["fleet-driver-names"], queryFn: async () => new Map(((await supabase.from("collaborators").select("id, full_name")).data ?? []).map((c) => [c.id, c.full_name])) });

  const ranking = useMemo(() => driverRanking(
    notes.data ?? [], schedules.data ?? [],
    new Map((vehicles.data ?? []).map((v) => [normalizePlate(v.plate), v.id])), names.data ?? new Map<string, string>(), today,
  ), [notes.data, schedules.data, vehicles.data, names.data, today]);
  const loading = notes.isLoading || schedules.isLoading || vehicles.isLoading || names.isLoading;
  const totals = ranking.reduce((s, r) => ({ delivered: s.delivered + r.delivered, pending: s.pending + r.pending, waiting: s.waiting + r.waiting }), { delivered: 0, pending: 0, waiting: 0 });
  const overall = totals.delivered + totals.pending ? Math.round((totals.delivered / (totals.delivered + totals.pending)) * 100) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O motorista de cada abastecimento é o que estava com o veículo na Transporte naquele dia (ou no dia anterior, para abastecimento de madrugada); sem programação, vale o nome escrito na nota. Pontuação = % das notas entregues (100 = sempre entrega). Abastecimentos dos últimos {NOTE_GRACE_DAYS} dias ainda estão no prazo e não contam. Clique em quem tem pendência para ver os XML sem nota.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rank-until">Até o mês</Label>
          <Input id="rank-until" type="month" className="w-44" value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Período</Label>
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Só este mês</SelectItem>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Pontuação geral" value={overall == null ? "—" : String(overall)} tone={overall != null && overall < 70 ? "bad" : undefined} />
        <Kpi label="Notas entregues" value={String(totals.delivered)} />
        <Kpi label="XML sem nota (pendentes)" value={String(totals.pending)} tone={totals.pending ? "bad" : undefined} />
        <Kpi label="Ainda no prazo" value={String(totals.waiting)} />
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead className="text-right">Abastecimentos</TableHead>
              <TableHead className="text-right">Notas entregues</TableHead>
              <TableHead className="text-right">Pendentes</TableHead>
              <TableHead className="text-right">No prazo</TableHead>
              <TableHead className="w-56">Pontuação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : !ranking.length ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhum abastecimento no período.</TableCell></TableRow>
            ) : ranking.map((r, i) => {
              const counted = r.delivered + r.pending;
              return (
                <Fragment key={r.key}>
                  <TableRow className={r.pending ? "cursor-pointer" : ""} onClick={() => r.pending && setOpen(open === r.key ? null : r.key)}>
                    <TableCell className="font-medium tabular-nums">{i + 1}º</TableCell>
                    <TableCell>
                      {r.name}
                      {r.source === "nota" && <span className="block text-xs text-muted-foreground">pelo nome da nota (sem programação na Transporte)</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.pending ? "font-medium text-destructive" : ""}`}>{r.pending}{r.pending ? (open === r.key ? " ▲" : " ▼") : ""}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.waiting}</TableCell>
                    <TableCell>
                      {counted ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${scoreTone(r.score)}`} style={{ width: `${r.score}%` }} /></div>
                          <span className="w-10 text-right font-semibold tabular-nums">{r.score}</span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">só abastecimentos no prazo</span>}
                    </TableCell>
                  </TableRow>
                  {open === r.key && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell />
                      <TableCell colSpan={6} className="text-sm">
                        <div className="mb-1 font-medium">XML sem nota</div>
                        {r.pendingNotes.map((p) => (
                          <div key={p.id} className="tabular-nums">{brDate(p.day)} · NF {p.nf ?? "—"} · {p.plate ?? "sem placa"} · {brl(p.total)}</div>
                        ))}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

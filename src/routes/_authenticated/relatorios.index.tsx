import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorios/")({
  head: () => ({
    meta: [
      { title: "Relatórios | Programação Operacional" },
      { name: "description", content: "Relatórios de alocação por obra, por colaborador e de ausências, com exportação em CSV." },
      { property: "og:title", content: "Relatórios | Programação Operacional" },
      { property: "og:description", content: "Relatórios de alocação por obra, por colaborador e de ausências, com exportação em CSV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth() {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
}

function fmtDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(";"),
    )
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type AllocRow = {
  id: string;
  overnight: boolean;
  driver: boolean;
  confirmation_status: string;
  daily_schedules: { schedule_date: string } | null;
  works: { name: string } | null;
  collaborators: { full_name: string } | null;
};

function Page() {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(iso(new Date()));

  const allocations = useQuery({
    queryKey: ["report-allocations", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select(
          "id, overnight, driver, confirmation_status, daily_schedules!inner(schedule_date), works(name), collaborators(full_name)",
        )
        .gte("daily_schedules.schedule_date", from)
        .lte("daily_schedules.schedule_date", to);
      if (error) throw error;
      return (data ?? []) as unknown as AllocRow[];
    },
  });

  const absences = useQuery({
    queryKey: ["report-absences", from, to],
    queryFn: async () => {
      const [vac, med, off] = await Promise.all([
        supabase
          .from("vacations")
          .select("id, start_date, end_date, collaborators(full_name)")
          .lte("start_date", to)
          .gte("end_date", from),
        supabase
          .from("medical_leaves")
          .select("id, start_date, end_date, collaborators(full_name)")
          .lte("start_date", to)
          .gte("end_date", from),
        supabase
          .from("days_off")
          .select("id, date, end_date, collaborators(full_name)")
          .lte("date", to)
          .or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`),
      ]);
      const rows: { id: string; tipo: string; nome: string; inicio: string; fim: string }[] = [];
      for (const v of vac.data ?? [])
        rows.push({
          id: `v-${v.id}`,
          tipo: "Férias",
          nome: (v as any).collaborators?.full_name ?? "—",
          inicio: v.start_date,
          fim: v.end_date,
        });
      for (const m of med.data ?? [])
        rows.push({
          id: `m-${m.id}`,
          tipo: "Atestado",
          nome: (m as any).collaborators?.full_name ?? "—",
          inicio: m.start_date,
          fim: m.end_date,
        });
      for (const d of off.data ?? [])
        rows.push({
          id: `d-${d.id}`,
          tipo: "Folga",
          nome: (d as any).collaborators?.full_name ?? "—",
          inicio: d.date,
          fim: d.end_date || d.date,
        });
      return rows.sort((a, b) => a.inicio.localeCompare(b.inicio));
    },
  });

  const data = allocations.data ?? [];

  const byWork = useMemo(() => {
    const map = new Map<string, { label: string; total: number; overnight: number; days: Set<string> }>();
    for (const a of data) {
      const key = a.works ? a.works.name : "Sem serviço";
      const entry = map.get(key) ?? { label: key, total: 0, overnight: 0, days: new Set<string>() };
      entry.total += 1;
      if (a.overnight) entry.overnight += 1;
      if (a.daily_schedules?.schedule_date) entry.days.add(a.daily_schedules.schedule_date);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]);

  const byCollaborator = useMemo(() => {
    const map = new Map<string, { label: string; total: number; overnight: number; driver: number }>();
    for (const a of data) {
      const key = a.collaborators?.full_name ?? "Sem colaborador";
      const entry = map.get(key) ?? { label: key, total: 0, overnight: 0, driver: 0 };
      entry.total += 1;
      if (a.overnight) entry.overnight += 1;
      if (a.driver) entry.driver += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]);

  const totals = useMemo(() => {
    const days = new Set(data.map((a) => a.daily_schedules?.schedule_date).filter(Boolean));
    return {
      allocations: data.length,
      days: days.size,
      overnight: data.filter((a) => a.overnight).length,
      people: new Set(data.map((a) => a.collaborators?.full_name).filter(Boolean)).size,
    };
  }, [data]);

  const loading = allocations.isLoading || absences.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Relatórios"
        description="Consolidação da programação e das ausências no período selecionado."
      />

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="from">De</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">Até</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        {loading && <span className="pb-2 text-sm text-muted-foreground">Carregando...</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Alocações" value={totals.allocations} />
        <SummaryCard label="Dias programados" value={totals.days} />
        <SummaryCard label="Colaboradores envolvidos" value={totals.people} />
        <SummaryCard label="Pernoites" value={totals.overnight} />
      </div>

      <Tabs defaultValue="obras">
        <TabsList>
          <TabsTrigger value="obras">Por obra</TabsTrigger>
          <TabsTrigger value="colaboradores">Por colaborador</TabsTrigger>
          <TabsTrigger value="ausencias">Ausências</TabsTrigger>
        </TabsList>

        <TabsContent value="obras" className="panel mt-3 overflow-x-auto p-0">
          <div className="flex justify-end p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(`relatorio-obras-${from}-a-${to}.csv`, [
                  ["Obra", "Alocações", "Dias", "Pernoites"],
                  ...byWork.map((w) => [w.label, w.total, w.days.size, w.overnight]),
                ])
              }
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Obra</TableHead>
                <TableHead className="text-right">Alocações</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="text-right">Pernoites</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byWork.map((w) => (
                <TableRow key={w.label}>
                  <TableCell className="font-medium">{w.label}</TableCell>
                  <TableCell className="text-right">{w.total}</TableCell>
                  <TableCell className="text-right">{w.days.size}</TableCell>
                  <TableCell className="text-right">{w.overnight}</TableCell>
                </TableRow>
              ))}
              {!loading && byWork.length === 0 && <EmptyRow cols={4} />}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="colaboradores" className="panel mt-3 overflow-x-auto p-0">
          <div className="flex justify-end p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(`relatorio-colaboradores-${from}-a-${to}.csv`, [
                  ["Colaborador", "Alocações", "Pernoites", "Como motorista"],
                  ...byCollaborator.map((c) => [c.label, c.total, c.overnight, c.driver]),
                ])
              }
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead className="text-right">Alocações</TableHead>
                <TableHead className="text-right">Pernoites</TableHead>
                <TableHead className="text-right">Como motorista</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCollaborator.map((c) => (
                <TableRow key={c.label}>
                  <TableCell className="font-medium">{c.label}</TableCell>
                  <TableCell className="text-right">{c.total}</TableCell>
                  <TableCell className="text-right">{c.overnight}</TableCell>
                  <TableCell className="text-right">{c.driver}</TableCell>
                </TableRow>
              ))}
              {!loading && byCollaborator.length === 0 && <EmptyRow cols={4} />}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="ausencias" className="panel mt-3 overflow-x-auto p-0">
          <div className="flex justify-end p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(`relatorio-ausencias-${from}-a-${to}.csv`, [
                  ["Tipo", "Colaborador", "Início", "Fim"],
                  ...(absences.data ?? []).map((a) => [a.tipo, a.nome, fmtDate(a.inicio), fmtDate(a.fim)]),
                ])
              }
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Colaborador</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(absences.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.tipo}</TableCell>
                  <TableCell className="font-medium">{a.nome}</TableCell>
                  <TableCell>{fmtDate(a.inicio)}</TableCell>
                  <TableCell>{fmtDate(a.fim)}</TableCell>
                </TableRow>
              ))}
              {!loading && (absences.data ?? []).length === 0 && <EmptyRow cols={4} />}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-muted-foreground">
        Nenhum registro no período selecionado.
      </TableCell>
    </TableRow>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { workedHours } from "@/lib/rdo";
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
      { title: "Alocações | Programação Operacional" },
      { name: "description", content: "Relatórios de alocação por obra, por colaborador e de ausências, com exportação em CSV." },
      { property: "og:title", content: "Alocações | Programação Operacional" },
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
  collaborator_id: string | null;
  overnight: boolean;
  driver: boolean;
  confirmation_status: string;
  daily_schedules: { schedule_date: string } | null;
  works: { id: string; client_id: string | null; name: string; order_number: string | null; client: string | null; clients: { name: string } | null } | null;
  collaborators: { full_name: string } | null;
};

function Page() {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [person, setPerson] = useState("");
  const people = useQuery({
    queryKey: ["report-people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, full_name").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const allocations = useQuery({
    queryKey: ["report-allocations", from, to],
    queryFn: async () => {
const out: AllocRow[] = [];
      for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase
          .from("daily_allocations")
          .select(
          "id, collaborator_id, overnight, driver, confirmation_status, daily_schedules!inner(schedule_date), works(id, name, order_number, client, client_id, clients(name)), collaborators(full_name)",
        )
          .gte("daily_schedules.schedule_date", from)
          .lte("daily_schedules.schedule_date", to)
          .order("id")
          .range(off, off + 999);
        if (error) throw error;
        out.push(...((data ?? []) as unknown as AllocRow[]));
        if (!data || data.length < 1000) break;
      }
      return out;
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

  const hours = useQuery({
    queryKey: ["report-hours", from, to],
    queryFn: async () => {
      const out: HourRow[] = [];
      for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase
          .from("rdo_workforce")
          .select("id, work_id, collaborator_id, report_date, entry_time, exit_time, break_minutes, worked_hours, present, collaborators(full_name)")
          .gte("report_date", from)
          .lte("report_date", to)
          .eq("present", true)
          .order("id")
          .range(off, off + 999);
        if (error) throw error;
        for (const r of (data ?? []) as any[]) {
          const h = r.worked_hours != null ? Number(r.worked_hours) : workedHours(r.entry_time, r.exit_time, r.break_minutes ?? 60);
          out.push({ work_id: r.work_id, collaborator_id: r.collaborator_id, name: r.collaborators?.full_name ?? "—", date: r.report_date, hours: h });
        }
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });

  const data = allocations.data ?? [];
  const hourRows = hours.data ?? [];
  const [detail, setDetail] = useState<Detail | null>(null);

  const workInfo = useMemo(() => {
    const m = new Map<string, { client: string; clientKey: string; name: string }>();
    for (const a of data) if (a.works) {
      const client = a.works.clients?.name ?? a.works.client ?? "Sem cliente";
      m.set(a.works.id, { client, clientKey: a.works.client_id ?? client, name: a.works.name });
    }
    return m;
  }, [data]);

  const byWork = useMemo(() => {
    const map = new Map<string, { key: string; label: string; client: string; clientKey: string; workId: string | null; hours: number; total: number; overnight: number; days: Set<string> }>();
    for (const a of data) {
      const key = a.works ? a.works.id : "none";
      const client = a.works ? a.works.clients?.name ?? a.works.client ?? "Sem cliente" : "—";
      const entry = map.get(key) ?? { key, label: a.works?.name ?? "Sem serviço", client, clientKey: a.works?.client_id ?? client, workId: a.works?.id ?? null, hours: 0, total: 0, overnight: 0, days: new Set<string>() };
      entry.total += 1;
      if (a.overnight) entry.overnight += 1;
      if (a.daily_schedules?.schedule_date) entry.days.add(a.daily_schedules.schedule_date);
      map.set(key, entry);
    }
    for (const h of hourRows) { const e = map.get(h.work_id); if (e) e.hours += h.hours; }
    return [...map.values()].sort((a, b) => a.client.localeCompare(b.client) || b.total - a.total);
  }, [data, hourRows]);

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

  const loading = allocations.isLoading || absences.isLoading || hours.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alocações"
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
        <div className="space-y-1">
          <Label htmlFor="person">Colaborador</Label>
          <select
            id="person"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Todos</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
        {loading && <span className="pb-2 text-sm text-muted-foreground">Carregando...</span>}
      </div>

      {person && (
        <div className="panel overflow-x-auto p-0">
          <p className="p-3 text-sm font-medium">
            Dia a dia de {(people.data ?? []).find((p) => p.id === person)?.full_name}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Pernoite</TableHead>
                <TableHead>Motorista</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data
                .filter((a) => a.collaborator_id === person)
                .sort((a, b) => (a.daily_schedules?.schedule_date ?? "").localeCompare(b.daily_schedules?.schedule_date ?? ""))
                .map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.daily_schedules ? fmtDate(a.daily_schedules.schedule_date) : "—"}</TableCell>
                    <TableCell>{a.works?.order_number || "—"}</TableCell>
                    <TableCell>{a.works?.clients?.name ?? a.works?.client ?? "—"}</TableCell>
                    <TableCell>{a.works?.name ?? "Sem serviço"}</TableCell>
                    <TableCell>{a.overnight ? "Sim" : "—"}</TableCell>
                    <TableCell>{a.driver ? "Sim" : "—"}</TableCell>
                  </TableRow>
                ))}
              {!loading && !data.some((a) => a.collaborator_id === person) && <EmptyRow cols={6} />}
            </TableBody>
          </Table>
        </div>
      )}

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
                  ["Cliente", "Serviço", "Alocações", "Dias", "Pernoites", "Horas trabalhadas"],
                  ...byWork.map((w) => [w.client, w.label, w.total, w.days.size, w.overnight, fmtH(w.hours)]),
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
                <TableHead>Cliente</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead className="text-right">Alocações</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="text-right">Pernoites</TableHead>
                <TableHead className="text-right">Horas trabalhadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byWork.map((w) => (
                <TableRow key={w.key}>
                  <TableCell>
                    <button type="button" className="text-left text-primary hover:underline" onClick={() => setDetail({ kind: "client", key: w.clientKey, title: w.client })}>{w.client}</button>
                  </TableCell>
                  <TableCell className="font-medium">
                    {w.workId ? (
                      <button type="button" className="text-left text-primary hover:underline" onClick={() => setDetail({ kind: "work", key: w.workId!, title: `${w.client} · ${w.label}` })}>{w.label}</button>
                    ) : w.label}
                  </TableCell>
                  <TableCell className="text-right">{w.total}</TableCell>
                  <TableCell className="text-right">{w.days.size}</TableCell>
                  <TableCell className="text-right">{w.overnight}</TableCell>
                  <TableCell className="text-right">
                    {w.workId ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => setDetail({ kind: "hours", key: w.workId!, title: `Horas trabalhadas · ${w.client} · ${w.label}` })}>{fmtH(w.hours)}</button>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && byWork.length === 0 && <EmptyRow cols={6} />}
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

      <DetailDialog detail={detail} onClose={() => setDetail(null)} data={data} hourRows={hourRows} workInfo={workInfo} from={from} to={to} />
    </div>
  );
}

type HourRow = { work_id: string; collaborator_id: string; name: string; date: string; hours: number };
type Detail = { kind: "client" | "work" | "hours"; key: string; title: string };

function fmtH(h: number) {
  return h.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " h";
}

function DetailDialog({ detail, onClose, data, hourRows, workInfo, from, to }: {
  detail: Detail | null; onClose: () => void; data: AllocRow[]; hourRows: HourRow[];
  workInfo: Map<string, { client: string; clientKey: string; name: string }>; from: string; to: string;
}) {
  const view = useMemo(() => {
    if (!detail) return null;
    const inScope = (workId: string | null | undefined) => {
      if (!workId) return false;
      if (detail.kind === "client") return workInfo.get(workId)?.clientKey === detail.key;
      return workId === detail.key;
    };
    const allocs = data.filter((a) => inScope(a.works?.id));
    const hrs = hourRows.filter((h) => inScope(h.work_id));
    const people = new Map<string, { name: string; hours: number; days: Set<string>; allocs: number }>();
    for (const a of allocs) {
      const k = a.collaborator_id ?? "—";
      const e = people.get(k) ?? { name: a.collaborators?.full_name ?? "—", hours: 0, days: new Set<string>(), allocs: 0 };
      e.allocs += 1; people.set(k, e);
    }
    for (const h of hrs) {
      const e = people.get(h.collaborator_id) ?? { name: h.name, hours: 0, days: new Set<string>(), allocs: 0 };
      e.hours += h.hours; if (h.hours > 0) e.days.add(h.date); people.set(h.collaborator_id, e);
    }
    const services = new Map<string, { name: string; allocs: number; hours: number; people: Set<string> }>();
    for (const a of allocs) {
      const id = a.works!.id;
      const e = services.get(id) ?? { name: a.works!.name, allocs: 0, hours: 0, people: new Set<string>() };
      e.allocs += 1; if (a.collaborator_id) e.people.add(a.collaborator_id); services.set(id, e);
    }
    for (const h of hrs) { const e = services.get(h.work_id); if (e) e.hours += h.hours; }
    const list = [...people.values()].filter((p) => detail.kind !== "hours" || p.hours > 0).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
    return {
      allocs: allocs.length,
      days: new Set(allocs.map((a) => a.daily_schedules?.schedule_date)).size,
      overnight: allocs.filter((a) => a.overnight).length,
      hours: hrs.reduce((s, h) => s + h.hours, 0),
      people: list,
      services: [...services.values()].sort((a, b) => b.hours - a.hours),
    };
  }, [detail, data, hourRows, workInfo]);

  const copy = async () => {
    if (!view) return;
    const text = ["Colaborador\tHoras trabalhadas", ...view.people.map((p) => `${p.name}\t${p.hours.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)].join("\n");
    await navigator.clipboard.writeText(text);
    toast.success(`${view.people.length} colaboradores copiados`);
  };

  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">Período de {fmtDate(from)} a {fmtDate(to)}</p>
        </DialogHeader>
        {view && (
          <div className="space-y-4">
            {detail?.kind !== "hours" && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Alocações" value={String(view.allocs)} />
                <MiniStat label="Dias" value={String(view.days)} />
                <MiniStat label="Pernoites" value={String(view.overnight)} />
                <MiniStat label="Horas trabalhadas" value={fmtH(view.hours)} />
              </div>
            )}
            {detail?.kind === "client" && (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Serviço</TableHead>
                  <TableHead className="text-right">Alocações</TableHead>
                  <TableHead className="text-right">Colaboradores</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {view.services.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">{s.allocs}</TableCell>
                      <TableCell className="text-right">{s.people.size}</TableCell>
                      <TableCell className="text-right">{fmtH(s.hours)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Colaboradores ({view.people.length}) · {fmtH(view.hours)}</p>
              <Button variant="outline" size="sm" onClick={copy} disabled={!view.people.length}>
                <Copy className="h-4 w-4" /> Copiar
              </Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Colaborador</TableHead>
                {detail?.kind !== "hours" && <TableHead className="text-right">Alocações</TableHead>}
                <TableHead className="text-right">Dias trabalhados</TableHead>
                <TableHead className="text-right">Horas trabalhadas</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {view.people.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    {detail?.kind !== "hours" && <TableCell className="text-right">{p.allocs}</TableCell>}
                    <TableCell className="text-right">{p.days.size}</TableCell>
                    <TableCell className="text-right">{fmtH(p.hours)}</TableCell>
                  </TableRow>
                ))}
                {view.people.length === 0 && <EmptyRow cols={4} />}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Horas trabalhadas vêm dos RDOs (presentes) do período.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
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

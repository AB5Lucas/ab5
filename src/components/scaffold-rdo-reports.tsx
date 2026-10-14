import type React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { fetchAll, monthEnd } from "@/lib/results-engine";
import { parseOrder } from "@/lib/andaimes";

/** Apontamentos e Produtividade de andaimes lidos ao vivo dos RDOs. */
export function useRdoFilters() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [workId, setWorkId] = useState("");
  const [clientId, setClientId] = useState("");
  const ym = `${year}-${month.padStart(2, "0")}`;
  return { year, setYear, month, setMonth, workId, setWorkId, clientId, setClientId, ym, start: `${ym}-01`, end: monthEnd(ym), wid: workId === "all" ? "" : workId };
}

export function RdoFilters({ f, extra }: { f: ReturnType<typeof useRdoFilters>; extra?: React.ReactNode }) {
  const works = useQuery({
    queryKey: ["suzano-works"],
    queryFn: async () => (await supabase.from("works").select("id, name, client_id, clients(name)").order("name")).data ?? [],
  });
  const clientOpts = [...new Map((works.data ?? []).filter((w: any) => w.clients?.name).map((w: any) => [w.client_id, w.clients.name] as [string, string])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 3 + i));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div><Label>Ano</Label>
        <Select value={f.year} onValueChange={f.setYear}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Mês</Label>
        <Select value={f.month} onValueChange={f.setMonth}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Cliente</Label>
        <Select value={f.clientId} onValueChange={(v) => { f.setClientId(v); f.setWorkId(""); }}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos</SelectItem>{clientOpts.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
      <div className="min-w-[280px]"><Label>Serviço</Label>
        <Select value={f.workId} onValueChange={f.setWorkId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos</SelectItem>
            {(works.data ?? []).filter((w: any) => !f.clientId || f.clientId === "all" || w.client_id === f.clientId).map((w: any) => (
              <SelectItem key={w.id} value={w.id}>{w.clients?.name ? `${w.clients.name} - ${w.name}` : w.name}</SelectItem>))}
          </SelectContent></Select></div>
      {extra}
    </div>
  );
}

export function MonthProductivity({ workId, start, end }: { workId: string; start: string; end: string }) {
  const p = useProdRows(workId, start, end);
  if (!workId) return null;
  return (
    <div className="rounded-md border px-3 py-1.5 text-sm">
      <div className="text-xs text-muted-foreground">Produtividade do mês</div>
      <div className="font-semibold">{n2(p.prod)} m³/pessoa <span className="text-xs font-normal text-muted-foreground">({n2(p.totalVol)} m³ ÷ {p.people} pessoas)</span></div>
    </div>
  );
}

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const br = (d: string) => d.split("-").reverse().join("/");
const n2 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Presentes nos RDOs do serviço no período (dado vivo, sem cópia). */
function usePresent(workId: string, start: string, end: string) {
  return useQuery({
    queryKey: ["suzano-present", workId, start, end],
    enabled: !!workId,
    queryFn: async () =>
      fetchAll<any>((a, b) =>
        supabase.from("rdo_workforce")
          .select("report_date, collaborator_id, present, positions(name), collaborators(full_name, cpf, positions(name))")
          .eq("work_id", workId).eq("present", true).gte("report_date", start).lte("report_date", end).order("id").range(a, b)),
  });
}

export function Apontamentos({ workId, start, end, ym }: { workId: string; start: string; end: string; ym: string }) {
  const present = usePresent(workId, start, end);
  const prio = useQuery({
    queryKey: ["foreman-priority"],
    queryFn: async () => (await supabase.from("closing_foreman_priority").select("id, collaborator_id, sort_order, collaborators(full_name)").order("sort_order")).data ?? [],
  });
  const [cfgOpen, setCfgOpen] = useState(false);

  const rows = useMemo(() => {
    const byDay = new Map<string, any[]>();
    const seen = new Set<string>();
    for (const r of present.data ?? []) {
      const k = `${r.report_date}|${r.collaborator_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const l = byDay.get(r.report_date) ?? [];
      l.push(r);
      byDay.set(r.report_date, l);
    }
    const order = (prio.data ?? []).map((p: any) => p.collaborator_id);
    const pos = (r: any) => String(r.positions?.name ?? r.collaborators?.positions?.name ?? "");
    const out: { date: string; name: string; cpf: string; role: string }[] = [];
    for (const date of [...byDay.keys()].sort()) {
      const people = byDay.get(date)!;
      const isTst = (r: any) => /\btst\b|t[ée]cnico de seguran/i.test(pos(r));
      const elig = people.filter((r) => !isTst(r));
      const boss =
        order.map((id: string) => elig.find((r) => r.collaborator_id === id)).find(Boolean) ??
        elig.find((r) => /encarregad/i.test(pos(r))) ??
        elig.find((r) => /l[ií]der/i.test(pos(r))) ??
        elig[0];
      const list = people.map((r) => ({
        date,
        name: r.collaborators?.full_name ?? "—",
        cpf: r.collaborators?.cpf ?? "",
        role: isTst(r) ? "TST" : r === boss ? "ENCARREGADO" : "MONTADOR DE ANDAIME",
      }));
      const rank = (x: { role: string }) => (x.role === "ENCARREGADO" ? 0 : x.role === "MONTADOR DE ANDAIME" ? 1 : 2);
      list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR"));
      out.push(...list);
    }
    return out;
  }, [present.data, prio.data]);

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({ Data: br(r.date), "Nome completo": r.name, CPF: r.cpf, "Função": r.role })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Apontamentos");
    XLSX.writeFile(wb, `apontamentos-suzano-${ym}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setCfgOpen(true)}>Prioridade de Encarregados</Button>
        <Button onClick={exportXlsx} disabled={!rows.length}><Download className="h-4 w-4" />Exportar Excel</Button>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Data</TableHead><TableHead>Nome completo</TableHead><TableHead>CPF</TableHead><TableHead>Função</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {present.isLoading && <TableRow><TableCell colSpan={4}>Carregando...</TableCell></TableRow>}
            {!present.isLoading && !rows.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nenhum colaborador presente nos RDOs do período.</TableCell></TableRow>}
            {rows.map((r, i) => (
              <TableRow key={i} className={i > 0 && rows[i - 1]!.date !== r.date ? "border-t-2" : ""}>
                <TableCell>{br(r.date)}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.cpf || "—"}</TableCell>
                <TableCell>{r.role}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PriorityDialog open={cfgOpen} onClose={() => setCfgOpen(false)} list={prio.data ?? []} />
    </div>
  );
}

function PriorityDialog({ open, onClose, list }: { open: boolean; onClose: () => void; list: any[] }) {
  const qc = useQueryClient();
  const { canWrite } = useCurrentUser();
  const [pick, setPick] = useState("");
  const people = useQuery({
    queryKey: ["collab-active-names"],
    enabled: open,
    queryFn: async () => (await supabase.from("collaborators").select("id, full_name").eq("status", "active").order("full_name")).data ?? [],
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["foreman-priority"] });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("closing_foreman_priority").insert({ collaborator_id: pick, sort_order: list.length });
      if (error) throw error;
    },
    onSuccess: () => { setPick(""); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const move = async (i: number, dir: -1 | 1) => {
    const a = list[i], b = list[i + dir];
    if (!a || !b) return;
    await Promise.all([
      supabase.from("closing_foreman_priority").update({ sort_order: b.sort_order === a.sort_order ? i + dir : b.sort_order }).eq("id", a.id),
      supabase.from("closing_foreman_priority").update({ sort_order: b.sort_order === a.sort_order ? i : a.sort_order }).eq("id", b.id),
    ]);
    refresh();
  };
  const remove = async (id: string) => {
    await supabase.from("closing_foreman_priority").delete().eq("id", id);
    refresh();
  };
  const used = new Set(list.map((l) => l.collaborator_id));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Prioridade de Encarregados</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">O primeiro da lista presente no RDO do dia fica como Encarregado.</p>
        {canWrite && (
          <div className="flex gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Adicionar colaborador" /></SelectTrigger>
              <SelectContent>
                {(people.data ?? []).filter((p) => !used.has(p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => add.mutate()} disabled={!pick}><Plus className="h-4 w-4" /></Button>
          </div>
        )}
        <ol className="max-h-80 space-y-1 overflow-y-auto">
          {list.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="w-6 text-muted-foreground">{i + 1}.</span>
              <span className="flex-1">{l.collaborators?.full_name ?? "—"}</span>
              {canWrite && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === list.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(l.id)}><Trash2 className="h-4 w-4" /></Button>
                </>
              )}
            </li>
          ))}
          {!list.length && <li className="text-sm text-muted-foreground">Nenhum colaborador na lista.</li>}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function useProdRows(workId: string, start: string, end: string) {
  const present = usePresent(workId, start, end);
  const scaf = useQuery({
    queryKey: ["suzano-scaffolds", workId, start, end],
    enabled: !!workId,
    queryFn: async () =>
      (await supabase.from("rdo_scaffolds").select("*, rdos!inner(report_date, work_id)")
        .eq("rdos.work_id", workId).gte("rdos.report_date", start).lte("rdos.report_date", end)).data ?? [],
  });
  const perDay = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of present.data ?? []) {
      const s = m.get(r.report_date) ?? new Set();
      s.add(r.collaborator_id);
      m.set(r.report_date, s);
    }
    return m;
  }, [present.data]);
  const rows = (scaf.data ?? [])
    .map((s: any) => {
      const date = s.rdos?.report_date as string;
      const vol = Number(s.length_m ?? 0) * Number(s.width_m ?? 0) * Number(s.height_m ?? 0) * Number(s.quantity ?? 1);
      const people = perDay.get(date)?.size ?? 0;
      const ord = [s.notes, s.location, s.scaffold_type].map((t) => parseOrder(t)).find(Boolean) ?? "";
      return { id: s.id, date, ord, op: s.operation, l: Number(s.length_m ?? 0), w: Number(s.width_m ?? 0), h: Number(s.height_m ?? 0), vol, people, prod: people ? vol / people : 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const ppl = new Set<string>();
  for (const r of rows) for (const id of perDay.get(r.date) ?? []) ppl.add(id);
  const totalVol = rows.reduce((s, r) => s + r.vol, 0);
  return { rows, loading: scaf.isLoading, totalVol, people: ppl.size, prod: ppl.size ? totalVol / ppl.size : 0 };
}

export function Produtividade({ workId, start, end }: { workId: string; start: string; end: string }) {
  const { rows, loading } = useProdRows(workId, start, end);
  return (
    <div className="panel overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead><TableHead>Ordem</TableHead><TableHead>Atividade</TableHead>
            <TableHead className="text-right">Comprimento (m)</TableHead><TableHead className="text-right">Largura (m)</TableHead>
            <TableHead className="text-right">Altura (m)</TableHead><TableHead className="text-right">Volume (m³)</TableHead>
            <TableHead className="text-right">Pessoas no dia</TableHead><TableHead className="text-right">Produtividade (m³/pessoa)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={9}>Carregando...</TableCell></TableRow>}
          {!loading && !rows.length && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Nenhum andaime registrado nos RDOs do período.</TableCell></TableRow>}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{br(r.date)}</TableCell>
              <TableCell>{r.ord || "—"}</TableCell>
              <TableCell>{r.op === "desmontagem" ? "Desmontagem" : "Montagem"}</TableCell>
              <TableCell className="text-right">{n2(r.l)}</TableCell>
              <TableCell className="text-right">{n2(r.w)}</TableCell>
              <TableCell className="text-right">{n2(r.h)}</TableCell>
              <TableCell className="text-right">{n2(r.vol)}</TableCell>
              <TableCell className="text-right">{r.people}</TableCell>
              <TableCell className="text-right font-medium">{n2(r.prod)} m³/pessoa</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

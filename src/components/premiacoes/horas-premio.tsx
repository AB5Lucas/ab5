import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManagePrizeHours, prizeAmount, prizeDates, prizeMultiplier, prizePeriod } from "@/lib/prize-hours";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
function initialMonth() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 26 ? 1 : 0), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function PrizeHoursPage() {
  const { role } = useCurrentUser();
  const allowed = canManagePrizeHours(role);
  const client = useQueryClient();
  const [month, setMonth] = useState(initialMonth);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [commonHours, setCommonHours] = useState("8");
  const [selected, setSelected] = useState<{ id: string; hours: string }[]>([]);
  const [personSearch, setPersonSearch] = useState("");
  const { start, end } = prizePeriod(month);
  const data = useQuery({
    queryKey: ["prize-hours", month], enabled: allowed,
    queryFn: async () => {
      const [people, holidays, entries] = await Promise.all([
        supabase.from("collaborators").select("id, full_name, registration_number, salary").order("full_name"),
        supabase.from("holidays").select("date, name").gte("date", start).lte("date", end),
        supabase.from("prize_hours").select("*").gte("entry_date", start).lte("entry_date", end),
      ]);
      for (const result of [people, holidays, entries]) if (result.error) throw result.error;
      return { people: people.data ?? [], holidays: holidays.data ?? [], entries: entries.data ?? [] };
    },
  });
  const holidays = (data.data?.holidays ?? []).map((row) => row.date);
  const dates = prizeDates(month, holidays);
  const multiplier = date ? prizeMultiplier(date, holidays) : null;
  const people = data.data?.people ?? [];
  const entries = data.data?.entries ?? [];
  const rows = people.filter((person) => `${person.full_name} ${person.registration_number}`.toLowerCase().includes(search.toLowerCase()));
  const entryMap = useMemo(() => new Map(entries.map((entry) => [`${entry.collaborator_id}:${entry.entry_date}`, entry])), [entries]);
  const save = useMutation({
    mutationFn: async () => {
      if (!multiplier || date < start || date > end) throw new Error("Escolha um sábado, domingo ou feriado da competência.");
      if (!selected.length) throw new Error("Selecione pelo menos um colaborador.");
      const payload = selected.map((row) => {
        const person = people.find((person) => person.id === row.id);
        const hours = Number(row.hours.replace(",", "."));
        if (!Number.isFinite(hours) || hours <= 0) throw new Error("Informe horas maiores que zero para cada colaborador.");
        if (!person?.salary || Number(person.salary) <= 0) throw new Error(`${person?.full_name ?? "Colaborador"} está sem valor hora cadastrado.`);
        return { collaborator_id: row.id, entry_date: date, hours };
      });
      const { error } = await supabase.from("prize_hours").upsert(payload, { onConflict: "collaborator_id,entry_date" });
      if (error) throw error;
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["prize-hours"] }); setOpen(false); toast.success("Horas Prêmio salvas."); },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("prize_hours").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { client.invalidateQueries({ queryKey: ["prize-hours"] }); setOpen(false); toast.success("Horas Prêmio removidas."); },
    onError: (error: Error) => toast.error(error.message),
  });
  function addPerson(id: string) {
    const existing = entryMap.get(`${id}:${date}`);
    setSelected((current) => [...current, { id, hours: existing ? String(existing.hours) : commonHours }]);
  }
  function exportSheet() {
    const workbook = XLSX.utils.book_new();
    const visibleIds = new Set(rows.map((person) => person.id));
    const detailRows = entries.filter((entry) => visibleIds.has(entry.collaborator_id)).map((entry) => {
      const person = people.find((person) => person.id === entry.collaborator_id);
      return [person?.registration_number ?? "", person?.full_name ?? "", entry.entry_date, Number(entry.hours), Number(entry.hourly_rate), Number(entry.multiplier), prizeAmount(Number(entry.hours), Number(entry.hourly_rate), Number(entry.multiplier))];
    });
    const detail = XLSX.utils.aoa_to_sheet([["Matrícula", "Funcionário", "Data", "Horas", "Valor hora (R$)", "Multiplicador", "Premiação (R$)"], ...detailRows]);
    detailRows.forEach((row, index) => {
      const r = index + 2;
      detail[`G${r}`] = { t: "n", f: `ROUND(D${r}*E${r}*F${r},2)`, v: row[6], z: '"R$" #,##0.00' };
      const cell = detail[`E${r}`]; if (cell) cell.z = '"R$" #,##0.00';
    });
    detail["!cols"] = [{ wch: 15 }, { wch: 45 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 20 }];
    const main = XLSX.utils.aoa_to_sheet([["Matrícula", "Funcionário", ...dates.map((day) => `${br(day)} (h)`), "Total premiação (R$)"], ...rows.map((person) => [person.registration_number, person.full_name, ...dates.map((day) => Number(entryMap.get(`${person.id}:${day}`)?.hours ?? 0)), entries.filter((entry) => entry.collaborator_id === person.id).reduce((sum, entry) => sum + prizeAmount(Number(entry.hours), Number(entry.hourly_rate), Number(entry.multiplier)), 0)])]);
    const totalColumn = XLSX.utils.encode_col(dates.length + 2);
    rows.forEach((person, index) => {
      const address = `${totalColumn}${index + 2}`;
      const cell = main[address];
      if (cell) { cell.f = `SUMIF(Detalhamento!A2:A${Math.max(detailRows.length + 1, 2)},A${index + 2},Detalhamento!G2:G${Math.max(detailRows.length + 1, 2)})`; cell.z = '"R$" #,##0.00'; }
    });
    main["!cols"] = [{ wch: 15 }, { wch: 45 }, ...dates.map(() => ({ wch: 14 })), { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, main, "Horas Prêmio");
    XLSX.utils.book_append_sheet(workbook, detail, "Detalhamento");
    XLSX.writeFile(workbook, `Horas_Premio_${month}.xlsx`);
  }
  if (!allowed) return null;
  return <div className="space-y-4">
    <PageHeader title="Horas Prêmio" description={`${br(start)} a ${br(end)} · ${month.slice(0, 4)}`} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!data.data || data.isError} onClick={exportSheet}><Download className="h-4 w-4" />Exportar planilha</Button><Button disabled={!data.data} onClick={() => { setDate(""); setSelected([]); setCommonHours("8"); setPersonSearch(""); setOpen(true); }}><Plus className="h-4 w-4" />Adicionar HP</Button></div>} />
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5"><Label htmlFor="hp-month">Competência</Label><Input id="hp-month" type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></div>
      <div className="min-w-56 flex-1 space-y-1.5"><Label htmlFor="hp-search">Nome ou matrícula</Label><Input id="hp-search" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    </div>
    {data.isError ? <p className="text-destructive">Não foi possível carregar Horas Prêmio. <Button variant="outline" onClick={() => data.refetch()}>Tentar novamente</Button></p> : <div className="overflow-x-auto border border-border rounded-md">
      <Table><TableHeader><TableRow><TableHead className="min-w-24">Matrícula</TableHead><TableHead className="min-w-64">Funcionário</TableHead>{dates.map((day) => <TableHead key={day} className="min-w-24 text-center"><div>{br(day)}</div><div className="text-xs font-normal">{holidays.includes(day) ? "Feriado" : new Date(`${day}T12:00:00Z`).getUTCDay() === 6 ? "Sábado" : "Domingo"}</div></TableHead>)}<TableHead className="min-w-36 text-right">Total em reais</TableHead></TableRow></TableHeader>
      <TableBody>{data.isLoading ? <TableRow><TableCell colSpan={dates.length + 3}>Carregando...</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={dates.length + 3}>Nenhum funcionário encontrado.</TableCell></TableRow> : rows.map((person) => <TableRow key={person.id}><TableCell>{person.registration_number}</TableCell><TableCell className="font-medium">{person.full_name}</TableCell>{dates.map((day) => {
        const entry = entryMap.get(`${person.id}:${day}`);
        return <TableCell key={day} className="text-center"><Button variant="ghost" size="sm" aria-label={`Horas de ${person.full_name} em ${br(day)}`} onClick={() => { setDate(day); setSelected([{ id: person.id, hours: String(entry?.hours ?? 8) }]); setPersonSearch(""); setOpen(true); }}>{entry ? `${entry.hours} h` : "—"}</Button></TableCell>;
      })}<TableCell className="text-right font-medium">{money(entries.filter((entry) => entry.collaborator_id === person.id).reduce((sum, entry) => sum + prizeAmount(Number(entry.hours), Number(entry.hourly_rate), Number(entry.multiplier)), 0))}</TableCell></TableRow>)}</TableBody></Table>
    </div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Adicionar HP</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-end gap-3"><div className="flex-1 space-y-1.5"><Label htmlFor="hp-date">Dia</Label><Input id="hp-date" type="date" min={start} max={end} value={date} disabled={save.isPending} onChange={(event) => { setDate(event.target.value); setSelected([]); }} /></div><div className="space-y-1.5"><Label>Adicional</Label><div className="h-9 flex items-center text-sm font-medium">{multiplier ? `${multiplier === 2 ? "100%" : "60%"} · × ${multiplier.toLocaleString("pt-BR")}` : "—"}</div></div></div>
      {date && !multiplier && <p className="text-sm text-destructive">Escolha um sábado, domingo ou feriado.</p>}
      {multiplier && <>
        <div className="space-y-1.5"><Label htmlFor="hp-common">Horas para novos colaboradores</Label><Input id="hp-common" type="number" min="0.01" step="0.25" value={commonHours} onChange={(event) => setCommonHours(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="hp-person-search">Buscar colaborador</Label><Input id="hp-person-search" value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} /></div>
        <Select value="" onValueChange={addPerson} disabled={save.isPending}><SelectTrigger aria-label="Adicionar colaborador"><SelectValue placeholder="Selecionar colaborador" /></SelectTrigger><SelectContent>{people.filter((person) => !selected.some((row) => row.id === person.id) && `${person.full_name} ${person.registration_number}`.toLowerCase().includes(personSearch.toLowerCase())).map((person) => <SelectItem key={person.id} value={person.id}>{person.full_name} · {person.registration_number}</SelectItem>)}</SelectContent></Select>
        <div className="divide-y divide-border">{selected.map((row) => {
          const person = people.find((person) => person.id === row.id);
          const existing = entryMap.get(`${row.id}:${date}`);
          return <div key={row.id} className="flex flex-wrap items-center gap-2 py-3"><div className="min-w-40 flex-1 text-sm"><div className="font-medium">{person?.full_name}</div><div className="text-muted-foreground">{person?.salary ? `${money(Number(person.salary))}/h` : "Sem valor hora cadastrado"}</div></div><Input className="w-24" aria-label={`Horas de ${person?.full_name}`} type="number" min="0.01" step="0.25" value={row.hours} disabled={save.isPending} onChange={(event) => setSelected((current) => current.map((item) => item.id === row.id ? { ...item, hours: event.target.value } : item))} /><span className="w-28 text-right text-sm">{money(prizeAmount(Number(row.hours) || 0, Number(person?.salary) || 0, multiplier))}</span><Button variant="ghost" size="icon" aria-label={`Retirar ${person?.full_name}`} disabled={save.isPending || remove.isPending} onClick={() => { if (existing) { if (window.confirm("Excluir as horas salvas deste funcionário neste dia?")) remove.mutate(existing.id); } else setSelected((current) => current.filter((item) => item.id !== row.id)); }}><Trash2 className="h-4 w-4" /></Button></div>;
        })}</div>
      </>}
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={!multiplier || !selected.length || save.isPending || remove.isPending} onClick={() => save.mutate()}>{save.isPending ? "Salvando..." : "Salvar HP"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
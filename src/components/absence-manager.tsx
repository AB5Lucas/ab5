import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { findDateConflicts } from "@/lib/date-conflicts";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatDateBR } from "@/lib/scheduling";
import { fetchAll } from "@/lib/fetch-all";
import { invalidateScheduleDay } from "@/lib/invalidate-day";

const today = () => new Date().toISOString().slice(0, 10);

type AbsenceTable = "vacations" | "medical_leaves" | "days_off";

type Row = {
  id: string;
  collaborator_id: string;
  start_date?: string;
  end_date?: string;
  date?: string;
  status?: string | null;
  reason?: string | null;
  document_url?: string | null;
  notes?: string | null;
};

export function AbsenceManager({
  table,
  title,
  description,
  mode,
  extraFieldLabel,
  extraFieldName,
  addLabel,
}: {
  table: AbsenceTable;
  title: string;
  description: string;
  mode: "period" | "single";
  extraFieldLabel?: string;
  extraFieldName?: "document_url" | "reason";
  addLabel: string;
}) {
  const { canWrite: roleWrite, isAdmin } = useCurrentUser();
  const { canAccess } = useAccess();
  const pagePath = "/ausencias";
  // Quem tem acesso à página (Acessos) pode incluir e editar
  const canWrite = roleWrite || canAccess(pagePath);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [singleEnd, setSingleEnd] = useState("");
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fq, setFq] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fRange, setFRange] = useState<DayRange | null>(null);

  const people = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const rows = useQuery({
    queryKey: [table],
    // Paginado: a tabela inteira passa de 1000 linhas (corte silencioso do PostgREST).
    queryFn: async () => (await fetchAll<Row>((a, b) => supabase
      .from(table)
      .select("*")
      .order(mode === "single" ? "date" : "start_date", { ascending: false })
      .order("id")
      .range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>)),
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (people.data ?? []).forEach((p) => m.set(p.id, p.full_name));
    return m;
  }, [people.data]);

  const reset = () => {
    setPerson("");
    setStart(today());
    setEnd(today());
    setSingleEnd("");
    setExtra("");
    setNotes("");
  };

  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setPerson(r.collaborator_id);
    if (mode === "single") {
      setStart(r.date ?? today());
      setSingleEnd(r.end_date ?? "");
    } else {
      setStart(r.start_date ?? today());
      setEnd(r.end_date ?? today());
    }
    setExtra((extraFieldName ? r[extraFieldName] : "") ?? "");
    setNotes(r.notes ?? "");
    setOpen(true);
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!person) throw new Error("Selecione o colaborador");
      const hasEnd = mode === "period" || (mode === "single" && !!singleEnd);
      if (hasEnd && (mode === "period" ? end : singleEnd) < start)
        throw new Error("A data final deve ser posterior à inicial");

      const base: Record<string, unknown> = {};
      if (extraFieldName) base[extraFieldName] = extra.trim() || null;
      if (table === "vacations") base["status"] = "scheduled";
      base["notes"] = notes.trim() || null;

      if (editingId && table === "vacations") delete base["status"];
      const payload: Record<string, unknown> =
        mode === "single"
          ? { ...base, collaborator_id: person, date: start, end_date: singleEnd || null }
          : { ...base, collaborator_id: person, start_date: start, end_date: end };

      if (table === "days_off" || table === "medical_leaves") {
        const to = mode === "period" ? end : singleEnd || start;
        const conflicts = await findDateConflicts(person, start, to, editingId ? { table, id: editingId } : undefined);
        if (conflicts.length) {
          const kind = table === "days_off" ? "AVISO" : "ALERTA";
          const ok = window.confirm(
            `${kind}: o colaborador já tem algo marcado nessa data:\n\n• ${conflicts.join("\n• ")}\n\nDeseja salvar mesmo assim?`,
          );
          if (!ok) throw new Error("Lançamento cancelado por conflito de datas");
        }
      }

      const { error } = editingId
        ? await supabase.from(table).update(payload as never).eq("id", editingId)
        : await supabase.from(table).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Registro atualizado." : "Registro salvo.");
      setOpen(false);
      reset();
      setEditingId(null);
      qc.invalidateQueries({ queryKey: [table] });
      invalidateScheduleDay(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro removido.");
      qc.invalidateQueries({ queryKey: [table] });
      invalidateScheduleDay(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isCurrent = (r: Row) => {
    const t = today();
    if (mode === "single") return (r.date ?? "") <= t && (r.end_date || r.date || "") >= t;
    return !!r.start_date && !!r.end_date && r.start_date <= t && r.end_date >= t;
  };

  const isPast = (r: Row) => {
    const t = today();
    return mode === "single" ? (r.end_date || r.date || "") < t : (r.end_date ?? "") < t;
  };

  const shown = (rows.data ?? []).filter((r) => {
    if (fq.trim() && !(nameById.get(r.collaborator_id) ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(fq.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) return false;
    if (fStatus === "current" && !isCurrent(r)) return false;
    if (fStatus === "past" && !isPast(r)) return false;
    if (fStatus === "future" && (isCurrent(r) || isPast(r))) return false;
    if (fRange) {
      const from = (mode === "single" ? r.date : r.start_date) ?? "";
      const to = (mode === "single" ? r.end_date || r.date : r.end_date) ?? from;
      if (from > fRange.to || to < fRange.from) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          canWrite && (
            <Button size="sm" onClick={() => { reset(); setEditingId(null); setOpen(true); }}>
              <Plus className="h-4 w-4" /> {addLabel}
            </Button>
          )
        }
      />

      {/* Filtros: nome, situação e período (registros que tocam o período). */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${table}-q`} className="block text-xs">Colaborador</Label>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input id={`${table}-q`} className="pl-8" placeholder="Buscar pelo nome" value={fq} onChange={(e) => setFq(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="block text-xs">Situação</Label>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="current">Em curso</SelectItem>
              <SelectItem value="future">Programado</SelectItem>
              <SelectItem value="past">Encerrado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DateRangePicker id={`${table}-range`} value={fRange} onChange={setFRange} onClear={() => setFRange(null)} emptyLabel="Qualquer data" />
        {(fq || fStatus !== "all" || fRange) && (
          <Button variant="ghost" size="sm" onClick={() => { setFq(""); setFStatus("all"); setFRange(null); }}>Limpar filtros</Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{shown.length} de {(rows.data ?? []).length}</span>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              {mode === "single" ? (
                <>
                  <TableHead>Data</TableHead>
                  <TableHead>Fim</TableHead>
                </>
              ) : (
                <>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                </>
              )}
              {extraFieldLabel && <TableHead className="hidden md:table-cell">{extraFieldLabel}</TableHead>}
              <TableHead>Situação</TableHead>
              <TableHead className="hidden lg:table-cell">Observações</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">{(rows.data ?? []).length ? "Nenhum registro com esses filtros." : "Nenhum registro cadastrado."}</TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{nameById.get(r.collaborator_id) ?? "—"}</TableCell>
                  {mode === "single" ? (
                    <>
                      <TableCell>{formatDateBR(r.date)}</TableCell>
                      <TableCell>{r.end_date ? formatDateBR(r.end_date) : "—"}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{formatDateBR(r.start_date)}</TableCell>
                      <TableCell>{formatDateBR(r.end_date)}</TableCell>
                    </>
                  )}
                  {extraFieldLabel && (
                    <TableCell className="hidden max-w-[220px] truncate md:table-cell">
                      {(extraFieldName ? r[extraFieldName] : null) || "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={isCurrent(r) ? "destructive" : isPast(r) ? "secondary" : "default"}>
                      {isCurrent(r) ? "Em curso" : isPast(r) ? "Encerrado" : "Programado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] truncate lg:table-cell">{r.notes || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {canWrite && (
                      <Button variant="ghost" size="icon" aria-label="Editar registro" onClick={() => startEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canWrite && (
                      <Button variant="ghost" size="icon" aria-label="Remover registro" onClick={() => remove.mutate(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? `Editar ${title.toLowerCase()}` : addLabel}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Colaborador *</Label>
              <Select value={person} onValueChange={setPerson}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === "single" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Data *</Label>
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fim (opcional)</Label>
                  <Input type="date" value={singleEnd} min={start} onChange={(e) => setSingleEnd(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Deixe em branco para lançar apenas um dia.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Início *</Label>
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fim *</Label>
                  <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
            )}
            {extraFieldLabel && (
              <div className="space-y-1">
                <Label>{extraFieldLabel}</Label>
                <Input value={extra} onChange={(e) => setExtra(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !canWrite}>
              {add.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

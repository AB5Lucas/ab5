import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const { canWrite, isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");

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
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order(mode === "single" ? "date" : "start_date", { ascending: false });
      if (error) throw error;
      return data as unknown as Row[];
    },
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
    setExtra("");
    setNotes("");
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!person) throw new Error("Selecione o colaborador");
      if (mode === "period" && end < start) throw new Error("A data final deve ser posterior à inicial");

      const payload: Record<string, unknown> =
        mode === "single"
          ? { collaborator_id: person, date: start }
          : { collaborator_id: person, start_date: start, end_date: end };

      if (extraFieldName) payload[extraFieldName] = extra.trim() || null;
      if (table === "vacations") payload["status"] = "scheduled";
      payload["notes"] = notes.trim() || null;

      const { error } = await supabase.from(table).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro salvo.");
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: [table] });
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isCurrent = (r: Row) => {
    const t = today();
    if (mode === "single") return r.date === t;
    return !!r.start_date && !!r.end_date && r.start_date <= t && r.end_date >= t;
  };

  const isPast = (r: Row) => {
    const t = today();
    return mode === "single" ? (r.date ?? "") < t : (r.end_date ?? "") < t;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          canWrite && (
            <Button size="sm" onClick={() => { reset(); setOpen(true); }}>
              <Plus className="h-4 w-4" /> {addLabel}
            </Button>
          )
        }
      />

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              {mode === "single" ? (
                <TableHead>Data</TableHead>
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
            ) : (rows.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">Nenhum registro cadastrado.</TableCell>
              </TableRow>
            ) : (
              (rows.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{nameById.get(r.collaborator_id) ?? "—"}</TableCell>
                  {mode === "single" ? (
                    <TableCell>{r.date}</TableCell>
                  ) : (
                    <>
                      <TableCell>{r.start_date}</TableCell>
                      <TableCell>{r.end_date}</TableCell>
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
                  <TableCell className="text-right">
                    {isAdmin && (
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
            <DialogTitle>{addLabel}</DialogTitle>
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
              <div className="space-y-1">
                <Label>Data *</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
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

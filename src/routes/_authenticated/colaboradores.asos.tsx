import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { AppointmentDialog } from "@/components/appointment-dialog";
import { useInConference, useScheduled } from "@/hooks/use-scheduled";
import { emptyToNull, normText, parseDate } from "@/lib/import-helpers";
import { asoStatusOf, formatDateBR, todayISO, ASO_LABEL, type AsoStatus } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/colaboradores/asos")({
  head: () => ({
    meta: [
      { title: "ASOs | Programação Operacional" },
      {
        name: "description",
        content:
          "Cadastro e controle dos Atestados de Saúde Ocupacional dos colaboradores, com vencimento automático em 1 ano.",
      },
      { property: "og:title", content: "ASOs | Programação Operacional" },
      {
        property: "og:description",
        content: "Controle de validade dos ASOs dos colaboradores da empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AsosPage,
});

type Row = {
  id: string;
  collaborator_id: string;
  exam_date: string;
  expires_at: string;
  notes: string | null;
};

const IMPORT_COLUMNS: ImportColumn[] = [
  {
    key: "matricula",
    required: true,
    hint: "Matrícula do colaborador já cadastrado.",
    example: "1042",
  },
  {
    key: "data_aso",
    required: true,
    hint: "Data de realização. AAAA-MM-DD ou DD/MM/AAAA. O vencimento é calculado automaticamente (1 ano).",
    example: "15/01/2026",
  },
];

const schema = z.object({
  collaborator_id: z.string().uuid("Selecione o colaborador"),
  exam_date: z.string().min(10, "Informe a data de realização"),
});

type FormState = { collaborator_id: string; exam_date: string; notes: string };

const emptyForm: FormState = { collaborator_id: "", exam_date: todayISO(), notes: "" };

/** Vencimento = 1 ano após a realização (mesma regra do banco). */
function expiryOf(examDate: string): string {
  const [y, m, d] = examDate.slice(0, 10).split("-");
  return `${Number(y) + 1}-${m}-${d}`;
}

function AsosPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const scheduled = useScheduled("aso");
  const inConf = useInConference("aso");
  const qc = useQueryClient();
  const today = todayISO();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [personQuery, setPersonQuery] = useState("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const asos = useQuery({
    queryKey: ["asos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asos")
        .select("id, collaborator_id, exam_date, expires_at, notes")
        .order("exam_date", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  const collaborators = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, registration_number, position_id")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("positions").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const personById = useMemo(() => {
    const m = new Map<
      string,
      { id: string; full_name: string; registration_number: string; position_id: string | null }
    >();
    (collaborators.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [collaborators.data]);

  const positionById = useMemo(() => {
    const m = new Map<string, string>();
    (positions.data ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [positions.data]);

  const filtered = useMemo(() => {
    const q = normText(search);
    return (asos.data ?? []).filter((r) => {
      const p = personById.get(r.collaborator_id);
      const status = asoStatusOf(r.expires_at, today);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (q) {
        const hit =
          normText(p?.full_name ?? "").includes(q) || normText(p?.registration_number ?? "").includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [asos.data, search, statusFilter, personById, today]);

  const summary = useMemo(() => {
    const s = { total: filtered.length, valid: 0, expiring: 0, expired: 0 };
    filtered.forEach((r) => {
      const st = asoStatusOf(r.expires_at, today);
      if (st === "valid") s.valid++;
      else if (st === "expiring") s.expiring++;
      else s.expired++;
    });
    return s;
  }, [filtered, today]);

  const peopleOptions = useMemo(() => {
    const q = normText(personQuery);
    const list = collaborators.data ?? [];
    if (!q) return list.slice(0, 50);
    return list
      .filter((p) => normText(p.full_name).includes(q) || normText(p.registration_number).includes(q))
      .slice(0, 50);
  }, [collaborators.data, personQuery]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        collaborator_id: form.collaborator_id,
        exam_date: form.exam_date,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("asos").update(payload).eq("id", editing.id);
        if (error) throw error;
        return;
      }
      const dup = (asos.data ?? []).find((r) => r.collaborator_id === payload.collaborator_id);
      if (dup) {
        const { error } = await supabase.from("asos").update(payload).eq("id", dup.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("asos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "ASO atualizado" : "ASO salvo");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["asos"] });
      qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("asos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ASO excluído");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["asos"] });
      qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setPersonQuery("");
    setOpen(true);
  }

  function openEdit(r: Row) {
    setEditing(r);
    setForm({ collaborator_id: r.collaborator_id, exam_date: r.exam_date, notes: r.notes ?? "" });
    setPersonQuery("");
    setOpen(true);
  }

  async function importRows(rows: ImportRow[]) {
    const errors: string[] = [];
    let inserted = 0;

    const byReg = new Map<string, string>();
    (collaborators.data ?? []).forEach((p) => {
      const k = normText(p.registration_number ?? "");
      if (k) byReg.set(k, p.id);
    });
    const existing = new Map<string, string>((asos.data ?? []).map((r) => [r.collaborator_id, r.id]));
    const seen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const line = i + 2;
      const reg = normText(r["matricula"] ?? "");
      const personId = reg ? byReg.get(reg) : undefined;
      if (!personId) {
        errors.push(`Linha ${line}: matrícula "${r["matricula"] ?? ""}" não encontrada no cadastro.`);
        continue;
      }
      const date = parseDate(r["data_aso"] ?? "");
      if (!date) {
        errors.push(`Linha ${line}: data de realização do ASO inválida.`);
        continue;
      }
      if (seen.has(personId)) {
        errors.push(`Linha ${line}: matrícula repetida na planilha.`);
        continue;
      }
      seen.add(personId);

      const payload = {
        collaborator_id: personId,
        exam_date: date,
        notes: emptyToNull(r["observacoes"] ?? ""),
      };
      const dupId = existing.get(personId);
      const { error } = dupId
        ? await supabase.from("asos").update(payload).eq("id", dupId)
        : await supabase.from("asos").insert(payload);
      if (error) errors.push(`Linha ${line}: ${error.message}`);
      else inserted++;
    }

    await qc.invalidateQueries({ queryKey: ["asos"] });
    await qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    return { inserted, errors };
  }

  const statusBadge = (st: AsoStatus) => (
    <Badge variant={st === "valid" ? "outline" : st === "expiring" ? "secondary" : "destructive"}>
      {ASO_LABEL[st]}
    </Badge>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="ASOs"
        description="Atestados de Saúde Ocupacional dos colaboradores. O vencimento é calculado automaticamente: 1 ano após a realização."
        actions={
          <div className="flex flex-wrap gap-2">
            <AppointmentDialog type="aso" />
            {canWrite && (
              <ImportDialog
                entity="ASOs"
                description="Importe os ASOs em massa. Informe apenas a matrícula e a data de realização — o vencimento é calculado automaticamente (1 ano)."
                columns={IMPORT_COLUMNS}
                onImport={importRows}
              />
            )}
            {canWrite && (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" /> Novo ASO
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">Total: {summary.total}</Badge>
        <Badge variant="outline">Válidos: {summary.valid}</Badge>
        <Badge variant="secondary">Próximos a vencer: {summary.expiring}</Badge>
        <Badge variant="destructive">Vencidos: {summary.expired}</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome ou matrícula"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="valid">Válidos</SelectItem>
            <SelectItem value="expiring">Próximos a vencer</SelectItem>
            <SelectItem value="expired">Vencidos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matrícula</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead className="hidden lg:table-cell">Função</TableHead>
              <TableHead className="hidden md:table-cell">Realização</TableHead>
              <TableHead className="hidden md:table-cell">Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {asos.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!asos.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Nenhum ASO encontrado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const p = personById.get(r.collaborator_id);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{p?.registration_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{p?.full_name ?? "—"}{scheduled.has(r.collaborator_id) && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">Agendado</Badge>}{inConf.has(r.collaborator_id) && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">Conferência</Badge>}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {(p?.position_id && positionById.get(p.position_id)) || "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateBR(r.exam_date)}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateBR(r.expires_at)}</TableCell>
                  <TableCell>{statusBadge(asoStatusOf(r.expires_at, today))}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(r)}
                          aria-label="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar ASO" : "Novo ASO"}</DialogTitle>
            <DialogDescription>
              O vencimento é calculado automaticamente: 1 ano após a data de realização.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="aso-person">Colaborador</Label>
              <Input
                id="aso-person"
                placeholder="Pesquisar por nome ou matrícula"
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
              />
              <Select value={form.collaborator_id} onValueChange={(v) => set("collaborator_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o colaborador" />
                </SelectTrigger>
                <SelectContent>
                  {peopleOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.registration_number} — {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="aso-date">Data de realização</Label>
                <Input
                  id="aso-date"
                  type="date"
                  value={form.exam_date}
                  onChange={(e) => set("exam_date", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Vencimento (automático)</Label>
                <Input readOnly value={form.exam_date ? formatDateBR(expiryOf(form.exam_date)) : "—"} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="aso-notes">Observações</Label>
              <Textarea
                id="aso-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ASO</AlertDialogTitle>
            <AlertDialogDescription>
              O ASO de {personById.get(deleting?.collaborator_id ?? "")?.full_name ?? "—"} será removido. Esta
              ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

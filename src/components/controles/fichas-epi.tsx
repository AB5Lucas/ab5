import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { copyNameList } from "@/lib/copy-names";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normText } from "@/lib/import-helpers";
import { asoStatusOf, expiryFrom, formatDateBR, todayISO } from "@/lib/scheduling";

type Sheet = { id: string; collaborator_id: string; delivered_at: string | null; expires_at: string | null; archived: boolean; notes: string | null };
type Status = "valid" | "expiring" | "expired" | "missing" | "archived";
const STATUS_LABEL: Record<Status, string> = { valid: "Válida", expiring: "Próxima a vencer", expired: "Vencida", missing: "Não possui", archived: "Arquivada" };

/** Arquivada não sinaliza mais; sem ficha conta como pendente, igual a vencida. */
export const epiStatusOf = (sheet: Pick<Sheet, "expires_at" | "archived"> | undefined, today: string): Status =>
  sheet?.archived ? "archived" : asoStatusOf(sheet?.expires_at, today);

type FormState = { collaborator_id: string; delivered_at: string; notes: string };
const emptyForm = (): FormState => ({ collaborator_id: "", delivered_at: todayISO(), notes: "" });

/** Fichas de EPI: todo colaborador ativo deve ter uma; vence 1 ano após a entrega. */
export function EpiSheetsPage() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const today = todayISO();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [personQuery, setPersonQuery] = useState("");
  const [deleting, setDeleting] = useState<Sheet | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const sheets = useQuery({
    queryKey: ["epi-sheets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("epi_sheets").select("id, collaborator_id, delivered_at, expires_at, archived, notes").range(0, 9999);
      if (error) throw error;
      return data as Sheet[];
    },
  });
  const collaborators = useQuery({
    queryKey: ["collaborators-min-active-aso"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, full_name, registration_number, position_id").eq("status", "active").order("full_name");
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
  const positionById = useMemo(() => new Map((positions.data ?? []).map((p) => [p.id, p.name])), [positions.data]);
  const sheetByPerson = useMemo(() => new Map((sheets.data ?? []).map((s) => [s.collaborator_id, s])), [sheets.data]);

  /** Uma linha por colaborador ativo, com ou sem ficha. */
  const rows = useMemo(
    () => (collaborators.data ?? []).map((p) => {
      const sheet = sheetByPerson.get(p.id);
      return { person: p, sheet, status: epiStatusOf(sheet, today) };
    }),
    [collaborators.data, sheetByPerson, today],
  );
  const filtered = useMemo(() => {
    const q = normText(search);
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !normText(r.person.full_name).includes(q) && !normText(r.person.registration_number ?? "").includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);
  const summary = useMemo(() => {
    const s: Record<Status, number> = { valid: 0, expiring: 0, expired: 0, missing: 0, archived: 0 };
    filtered.forEach((r) => s[r.status]++);
    return s;
  }, [filtered]);

  const peopleOptions = useMemo(() => {
    const q = normText(personQuery);
    const list = collaborators.data ?? [];
    return (q ? list.filter((p) => normText(p.full_name).includes(q) || normText(p.registration_number ?? "").includes(q)) : list).slice(0, 50);
  }, [collaborators.data, personQuery]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["epi-sheets"] });
    qc.invalidateQueries({ queryKey: ["menu-badges"] });
  };

  /** Uma ficha por colaborador: salvar uma entrega nova substitui a anterior e desarquiva. */
  const save = useMutation({
    mutationFn: async () => {
      if (!form.collaborator_id) throw new Error("Selecione o colaborador");
      if (!form.delivered_at) throw new Error("Informe a data de entrega");
      const { error } = await supabase.from("epi_sheets").upsert(
        { collaborator_id: form.collaborator_id, delivered_at: form.delivered_at, notes: form.notes.trim() || null, archived: false },
        { onConflict: "collaborator_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ficha de EPI salva");
      setOpen(false);
      setForm(emptyForm());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Clique no status: vencida ou sem ficha → arquivada; arquivada → volta a sinalizar. */
  const toggleArchive = useMutation({
    mutationFn: async ({ personId, value }: { personId: string; value: boolean }) => {
      const { error } = await supabase.from("epi_sheets").upsert({ collaborator_id: personId, archived: value }, { onConflict: "collaborator_id" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("epi_sheets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ficha de EPI excluída");
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = (personId = "") => {
    setForm({ ...emptyForm(), collaborator_id: personId });
    setPersonQuery("");
    setOpen(true);
  };

  const statusCell = (personId: string, st: Status) => {
    const variant = st === "valid" ? "outline" : st === "expiring" ? "secondary" : st === "archived" ? "outline" : "destructive";
    const clickable = canWrite && (st === "expired" || st === "missing" || st === "archived");
    const badge = <Badge variant={variant} className={st === "archived" ? "text-muted-foreground" : undefined}>{STATUS_LABEL[st]}</Badge>;
    if (!clickable) return badge;
    return (
      <button
        type="button"
        className="cursor-pointer"
        title={st === "archived" ? "Voltar a sinalizar" : "Arquivar (não sinaliza mais)"}
        disabled={toggleArchive.isPending}
        onClick={() => toggleArchive.mutate({ personId, value: st !== "archived" })}
      >
        {badge}
      </button>
    );
  };

  const loading = sheets.isLoading || collaborators.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fichas de EPI"
        description="Todo colaborador ativo deve ter uma ficha de EPI. O vencimento é calculado automaticamente: 1 ano após a entrega. Clique em Vencida ou Não possui para arquivar."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copyNameList("Fichas de EPI", filtered.map((r) => r.person.full_name))}>
              <Copy className="h-4 w-4" /> Copiar nomes
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => openNew()}>
                <Plus className="h-4 w-4" /> Nova ficha
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">Total: {filtered.length}</Badge>
        <Badge variant="outline">Válidas: {summary.valid}</Badge>
        <Badge variant="secondary">Próximas a vencer: {summary.expiring}</Badge>
        <Badge variant="destructive">Vencidas: {summary.expired}</Badge>
        <Badge variant="destructive">Não possuem: {summary.missing}</Badge>
        <Badge variant="outline">Arquivadas: {summary.archived}</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 lg:col-span-2">
          <Label htmlFor="epi-search">Colaborador</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input id="epi-search" className="pl-8" placeholder="Buscar por nome ou matrícula" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="valid">Válidas</SelectItem>
              <SelectItem value="expiring">Próximas a vencer</SelectItem>
              <SelectItem value="expired">Vencidas</SelectItem>
              <SelectItem value="missing">Não possuem</SelectItem>
              <SelectItem value="archived">Arquivadas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {sheets.error && <p className="text-sm text-destructive">{(sheets.error as Error).message}</p>}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matrícula</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead className="hidden lg:table-cell">Função</TableHead>
              <TableHead className="hidden md:table-cell">Entrega</TableHead>
              <TableHead className="hidden md:table-cell">Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Nenhum colaborador encontrado.</TableCell>
              </TableRow>
            )}
            {filtered.map(({ person: p, sheet, status }) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.registration_number ?? "—"}</TableCell>
                <TableCell className="font-medium">{p.full_name}</TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{(p.position_id && positionById.get(p.position_id)) || "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{sheet?.delivered_at ? formatDateBR(sheet.delivered_at) : "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{sheet?.expires_at ? formatDateBR(sheet.expires_at) : "—"}</TableCell>
                <TableCell>{statusCell(p.id, status)}</TableCell>
                <TableCell>
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={sheet?.delivered_at ? "Editar ficha" : "Registrar ficha"}
                        title={sheet?.delivered_at ? "Editar ficha" : "Registrar ficha"}
                        onClick={() => {
                          setForm({ collaborator_id: p.id, delivered_at: sheet?.delivered_at ?? todayISO(), notes: sheet?.notes ?? "" });
                          setPersonQuery("");
                          setOpen(true);
                        }}
                      >
                        {sheet?.delivered_at ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </Button>
                      {sheet && (
                        <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setDeleting(sheet)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ficha de EPI</DialogTitle>
            <DialogDescription>O vencimento é calculado automaticamente: 1 ano após a data de entrega.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="epi-person">Colaborador</Label>
              <Input id="epi-person" placeholder="Pesquisar por nome ou matrícula" value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} />
              <Select value={form.collaborator_id} onValueChange={(v) => set("collaborator_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o colaborador" />
                </SelectTrigger>
                <SelectContent>
                  {[...(form.collaborator_id && !peopleOptions.some((p) => p.id === form.collaborator_id) ? (collaborators.data ?? []).filter((p) => p.id === form.collaborator_id) : []), ...peopleOptions].map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.registration_number} — {p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="epi-date">Data de entrega</Label>
                <Input id="epi-date" type="date" value={form.delivered_at} onChange={(e) => set("delivered_at", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Vencimento (automático)</Label>
                <Input readOnly value={form.delivered_at ? formatDateBR(expiryFrom(form.delivered_at, 12)) : "—"} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="epi-notes">Observações</Label>
              <Textarea id="epi-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ficha de EPI</AlertDialogTitle>
            <AlertDialogDescription>
              A ficha de {(collaborators.data ?? []).find((p) => p.id === deleting?.collaborator_id)?.full_name ?? "—"} será removida e ele volta a aparecer como "Não possui". Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Trash2, Users, ClipboardList, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";

type WorkStatusValue = Tables<"works">["status"];

export const Route = createFileRoute("/_authenticated/obras/")({
  head: () => ({
    meta: [
      { title: "Serviços | Programação Operacional" },
      { name: "description", content: "Cadastro de serviços por cliente, com horários de entrada e saída e responsáveis." },
      { property: "og:title", content: "Serviços | Programação Operacional" },
      { property: "og:description", content: "Cadastro de serviços por cliente e responsáveis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorksPage,
});

type Work = Tables<"works">;
type WorkStatus = Work["status"];

const NONE = "__none__";

/** Horário padrão de todos os serviços. */
export const DEFAULT_ENTRY = "07:00";
export const DEFAULT_EXIT = "17:00";
export const DEFAULT_EXIT_WEEKEND = "16:00";

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  planned: "Planejada",
  active: "Ativa",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const schema = z.object({
  name: z.string().trim().min(3, "Informe o nome do serviço").max(150),
  client_id: z.string().min(1, "Selecione o cliente"),
});

type FormState = {
  client_id: string;
  name: string;
  entry_time: string;
  exit_time: string;
  exit_time_weekend: string;
  status: WorkStatusValue;
  supervisor_id: string;
  manager_id: string;
  active: boolean;
  notes: string;
};

const emptyForm: FormState = {
  client_id: "",
  name: "",
  entry_time: DEFAULT_ENTRY,
  exit_time: DEFAULT_EXIT,
  exit_time_weekend: DEFAULT_EXIT_WEEKEND,
  status: "active",
  supervisor_id: NONE,
  manager_id: NONE,
  active: true,
  notes: "",
};

function toForm(w: Work): FormState {
  return {
    client_id: w.client_id ?? "",
    name: w.name ?? "",
    entry_time: w.entry_time ? String(w.entry_time).slice(0, 5) : DEFAULT_ENTRY,
    exit_time: w.exit_time ? String(w.exit_time).slice(0, 5) : DEFAULT_EXIT,
    exit_time_weekend: w.exit_time_weekend ? String(w.exit_time_weekend).slice(0, 5) : DEFAULT_EXIT_WEEKEND,
    status: w.status,
    supervisor_id: w.supervisor_id ?? NONE,
    manager_id: w.manager_id ?? NONE,
    active: w.active,
    notes: w.notes ?? "",
  };
}

const nn = (v: string) => (v.trim() === "" ? null : v.trim());
const ref = (v: string) => (v === NONE ? null : v);

function statusVariant(s: WorkStatus) {
  if (s === "active") return "default" as const;
  if (s === "cancelled" || s === "completed") return "secondary" as const;
  return "outline" as const;
}

function WorksPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | WorkStatus>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Work | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<Work | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const works = useQuery({
    queryKey: ["works"],
    queryFn: async () => {
      const { data, error } = await supabase.from("works").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, city, state").order("name");
      if (error) throw error;
      return data;
    },
  });

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

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (people.data ?? []).forEach((p) => map.set(p.id, p.full_name));
    return map;
  }, [people.data]);

  const clientById = useMemo(() => {
    const map = new Map<string, { name: string; city: string | null; state: string | null }>();
    (clients.data ?? []).forEach((c) => map.set(c.id, { name: c.name, city: c.city, state: c.state }));
    return map;
  }, [clients.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (works.data ?? []).filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (!q) return true;
      const clientName = w.client_id ? (clientById.get(w.client_id)?.name ?? "") : "";
      return [w.name, clientName].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [works.data, search, statusFilter, clientById]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);

      const payload = {
        client_id: form.client_id,
        name: form.name.trim(),
        client: clientById.get(form.client_id)?.name ?? null,
        entry_time: form.entry_time || DEFAULT_ENTRY,
        exit_time: form.exit_time || DEFAULT_EXIT,
        exit_time_weekend: form.exit_time_weekend || DEFAULT_EXIT_WEEKEND,
        status: form.status,
        supervisor_id: ref(form.supervisor_id),
        manager_id: ref(form.manager_id),
        active: form.active,
        notes: nn(form.notes),
      };

      if (editing) {
        const { error } = await supabase.from("works").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("works").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Serviço atualizado" : "Serviço cadastrado");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["works"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("works").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Serviço excluído");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["works"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(w: Work) {
    setEditing(w);
    setForm(toForm(w));
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Serviços"
        description="Cadastro de serviços por cliente, com horários de entrada e saída."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/clientes">
                <Building2 className="h-4 w-4" /> Clientes
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/obras/requisitos">
                <ClipboardList className="h-4 w-4" /> Requisitos
              </Link>
            </Button>
            {canWrite && (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" /> Novo serviço
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por serviço ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(WORK_STATUS_LABEL) as WorkStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {WORK_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serviço</TableHead>
              <TableHead className="hidden md:table-cell">Cliente</TableHead>
              <TableHead className="hidden lg:table-cell">Cidade</TableHead>
              <TableHead className="hidden xl:table-cell">Seg–Qui</TableHead>
              <TableHead className="hidden xl:table-cell">Sex–Dom</TableHead>
              <TableHead className="hidden xl:table-cell">Encarregado</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {works.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!works.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Nenhum serviço encontrado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((w) => {
              const c = w.client_id ? clientById.get(w.client_id) : null;
              return (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{c?.name ?? w.client ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {[c?.city, c?.state].filter(Boolean).join("/") || "—"}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {`${String(w.entry_time ?? DEFAULT_ENTRY).slice(0, 5)} - ${String(w.exit_time ?? DEFAULT_EXIT).slice(0, 5)}`}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {`${String(w.entry_time ?? DEFAULT_ENTRY).slice(0, 5)} - ${String(w.exit_time_weekend ?? DEFAULT_EXIT_WEEKEND).slice(0, 5)}`}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {w.supervisor_id ? (nameById.get(w.supervisor_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(w.status)}>{WORK_STATUS_LABEL[w.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(w)} aria-label="Editar serviço">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(w)} aria-label="Excluir serviço">
                          <Trash2 className="h-4 w-4 text-destructive" />
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Cliente *</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.city ? ` · ${c.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(clients.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum cliente cadastrado ainda — cadastre em Clientes.
                </p>
              )}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Nome do serviço *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Entrada</Label>
              <Input type="time" value={form.entry_time} onChange={(e) => set("entry_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Saída (seg a qui)</Label>
              <Input type="time" value={form.exit_time} onChange={(e) => set("exit_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Saída (sex a dom)</Label>
              <Input
                type="time"
                value={form.exit_time_weekend}
                onChange={(e) => set("exit_time_weekend", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as WorkStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WORK_STATUS_LABEL) as WorkStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {WORK_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Encarregado</Label>
              <Select value={form.supervisor_id} onValueChange={(v) => set("supervisor_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Gestor</Label>
              <Select value={form.manager_id} onValueChange={(v) => set("manager_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} id="work-active" />
              <Label htmlFor="work-active">Serviço disponível para programação</Label>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !canWrite}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir serviço?</AlertDialogTitle>
            <AlertDialogDescription>
              O serviço "{deleting?.name}" será removido permanentemente. Registros vinculados podem impedir a exclusão.
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

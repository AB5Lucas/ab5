import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Trash2, Users, ClipboardList } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/obras/")({
  head: () => ({
    meta: [
      { title: "Obras | Programação Operacional" },
      { name: "description", content: "Cadastro de obras: endereço, distância, horários, status e responsáveis." },
      { property: "og:title", content: "Obras | Programação Operacional" },
      { property: "og:description", content: "Cadastro de obras, endereços, distâncias e responsáveis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorksPage,
});

type Work = Tables<"works">;
type WorkStatus = Work["status"];

const NONE = "__none__";

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  planned: "Planejada",
  active: "Ativa",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const schema = z.object({
  code: z.string().trim().min(1, "Informe o código").max(30),
  name: z.string().trim().min(3, "Informe o nome da obra").max(150),
  client: z.string().trim().max(150).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: z.string().trim().max(2, "UF com 2 letras").optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type FormState = {
  code: string;
  name: string;
  client: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  distance_km: string;
  estimated_travel_time: string;
  start_date: string;
  expected_end_date: string;
  entry_time: string;
  exit_time: string;
  status: WorkStatus;
  supervisor_id: string;
  manager_id: string;
  active: boolean;
  notes: string;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  client: "",
  address: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  distance_km: "",
  estimated_travel_time: "",
  start_date: "",
  expected_end_date: "",
  entry_time: "",
  exit_time: "",
  status: "planned",
  supervisor_id: NONE,
  manager_id: NONE,
  active: true,
  notes: "",
};

function toForm(w: Work): FormState {
  return {
    code: w.code ?? "",
    name: w.name ?? "",
    client: w.client ?? "",
    address: w.address ?? "",
    number: w.number ?? "",
    neighborhood: w.neighborhood ?? "",
    city: w.city ?? "",
    state: w.state ?? "",
    zip_code: w.zip_code ?? "",
    distance_km: w.distance_km != null ? String(w.distance_km) : "",
    estimated_travel_time: w.estimated_travel_time != null ? String(w.estimated_travel_time) : "",
    start_date: w.start_date ?? "",
    expected_end_date: w.expected_end_date ?? "",
    entry_time: w.entry_time ? String(w.entry_time).slice(0, 5) : "",
    exit_time: w.exit_time ? String(w.exit_time).slice(0, 5) : "",
    status: w.status,
    supervisor_id: w.supervisor_id ?? NONE,
    manager_id: w.manager_id ?? NONE,
    active: w.active,
    notes: w.notes ?? "",
  };
}

const nn = (v: string) => (v.trim() === "" ? null : v.trim());
const ref = (v: string) => (v === NONE ? null : v);
const num = (v: string) => (v.trim() === "" ? null : Number(v));

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
      const { data, error } = await supabase.from("works").select("*").order("code");
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (works.data ?? []).filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (!q) return true;
      return [w.code, w.name, w.client, w.city].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [works.data, search, statusFilter]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);

      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        client: nn(form.client),
        address: nn(form.address),
        number: nn(form.number),
        neighborhood: nn(form.neighborhood),
        city: nn(form.city),
        state: nn(form.state)?.toUpperCase() ?? null,
        zip_code: nn(form.zip_code),
        distance_km: num(form.distance_km),
        estimated_travel_time: num(form.estimated_travel_time),
        start_date: nn(form.start_date),
        expected_end_date: nn(form.expected_end_date),
        entry_time: nn(form.entry_time),
        exit_time: nn(form.exit_time),
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
      toast.success(editing ? "Obra atualizada" : "Obra cadastrada");
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
      toast.success("Obra excluída");
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
      <PageHeader title="Obras" description="Cadastro de obras, endereços, distâncias e responsáveis."
        actions={
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/obras/equipes-base">
            <Users className="h-4 w-4" /> Equipes Base
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/obras/requisitos">
            <ClipboardList className="h-4 w-4" /> Requisitos
          </Link>
        </Button>
        {canWrite && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> Nova obra
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
            placeholder="Buscar por código, nome, cliente ou cidade"
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
              <TableHead>Código</TableHead>
              <TableHead>Obra</TableHead>
              <TableHead className="hidden md:table-cell">Cliente</TableHead>
              <TableHead className="hidden lg:table-cell">Cidade</TableHead>
              <TableHead className="hidden lg:table-cell">Distância</TableHead>
              <TableHead className="hidden xl:table-cell">Horário</TableHead>
              <TableHead className="hidden xl:table-cell">Encarregado</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {works.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!works.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Nenhuma obra encontrada.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-mono text-xs">{w.code}</TableCell>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell className="hidden md:table-cell">{w.client ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {[w.city, w.state].filter(Boolean).join("/") || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {w.distance_km != null ? `${w.distance_km} km` : "—"}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  {w.entry_time || w.exit_time
                    ? `${String(w.entry_time ?? "--:--").slice(0, 5)} - ${String(w.exit_time ?? "--:--").slice(0, 5)}`
                    : "—"}
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
                      <Button variant="ghost" size="icon" onClick={() => openEdit(w)} aria-label="Editar obra">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(w)} aria-label="Excluir obra">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar obra" : "Nova obra"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Código *</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Nome da obra *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Cliente</Label>
              <Input value={form.client} onChange={(e) => set("client", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Número</Label>
              <Input value={form.number} onChange={(e) => set("number", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Bairro</Label>
              <Input value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cidade</Label>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Input maxLength={2} value={form.state} onChange={(e) => set("state", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>CEP</Label>
              <Input value={form.zip_code} onChange={(e) => set("zip_code", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Distância (km)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.distance_km}
                onChange={(e) => set("distance_km", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Tempo de deslocamento (min)</Label>
              <Input
                type="number"
                value={form.estimated_travel_time}
                onChange={(e) => set("estimated_travel_time", e.target.value)}
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
              <Label>Início</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Previsão de término</Label>
              <Input
                type="date"
                value={form.expected_end_date}
                onChange={(e) => set("expected_end_date", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Horário de entrada</Label>
              <Input type="time" value={form.entry_time} onChange={(e) => set("entry_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Horário de saída</Label>
              <Input type="time" value={form.exit_time} onChange={(e) => set("exit_time", e.target.value)} />
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
              <Label htmlFor="work-active">Obra disponível para programação</Label>
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
            <AlertDialogTitle>Excluir obra?</AlertDialogTitle>
            <AlertDialogDescription>
              A obra "{deleting?.name}" será removida permanentemente. Registros vinculados podem impedir a exclusão.
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

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Settings2, Trash2 } from "lucide-react";
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
  DialogTrigger,
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

export const Route = createFileRoute("/_authenticated/colaboradores/")({
  head: () => ({
    meta: [
      { title: "Colaboradores | Programação Operacional" },
      { name: "description", content: "Cadastro de colaboradores: dados pessoais, cargo, setor, supervisão e habilitação de motorista." },
      { property: "og:title", content: "Colaboradores | Programação Operacional" },
      { property: "og:description", content: "Cadastro completo de colaboradores da operação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CollaboratorsPage,
});

type Collaborator = Tables<"collaborators">;

const NONE = "__none__";

const schema = z.object({
  registration_number: z.string().trim().min(1, "Informe a matrícula").max(30),
  full_name: z.string().trim().min(3, "Informe o nome completo").max(150),
  social_name: z.string().trim().max(150).optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").max(255).optional().or(z.literal("")),
  birth_date: z.string().optional().or(z.literal("")),
  hire_date: z.string().optional().or(z.literal("")),
  driver_license_category: z.string().trim().max(10).optional().or(z.literal("")),
  driver_license_expiry: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type FormState = {
  registration_number: string;
  full_name: string;
  social_name: string;
  cpf: string;
  phone: string;
  email: string;
  birth_date: string;
  hire_date: string;
  position_id: string;
  department_id: string;
  sector_id: string;
  supervisor_id: string;
  status: "active" | "inactive";
  is_driver: boolean;
  driver_license_category: string;
  driver_license_expiry: string;
  notes: string;
};

const emptyForm: FormState = {
  registration_number: "",
  full_name: "",
  social_name: "",
  cpf: "",
  phone: "",
  email: "",
  birth_date: "",
  hire_date: "",
  position_id: NONE,
  department_id: NONE,
  sector_id: NONE,
  supervisor_id: NONE,
  status: "active",
  is_driver: false,
  driver_license_category: "",
  driver_license_expiry: "",
  notes: "",
};

function toForm(c: Collaborator): FormState {
  return {
    registration_number: c.registration_number ?? "",
    full_name: c.full_name ?? "",
    social_name: c.social_name ?? "",
    cpf: c.cpf ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    birth_date: c.birth_date ?? "",
    hire_date: c.hire_date ?? "",
    position_id: c.position_id ?? NONE,
    department_id: c.department_id ?? NONE,
    sector_id: c.sector_id ?? NONE,
    supervisor_id: c.supervisor_id ?? NONE,
    status: c.status,
    is_driver: c.is_driver,
    driver_license_category: c.driver_license_category ?? "",
    driver_license_expiry: c.driver_license_expiry ?? "",
    notes: c.notes ?? "",
  };
}

const nn = (v: string) => (v.trim() === "" ? null : v.trim());
const ref = (v: string) => (v === NONE ? null : v);

function CollaboratorsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Collaborator | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<Collaborator | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const collaborators = useQuery({
    queryKey: ["collaborators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("*").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const lookups = useQuery({
    queryKey: ["collaborator-lookups"],
    queryFn: async () => {
      const [positions, departments, sectors] = await Promise.all([
        supabase.from("positions").select("id, name, active").eq("active", true).order("name"),
        supabase.from("departments").select("id, name, active").eq("active", true).order("name"),
        supabase.from("sectors").select("id, name, department_id, active").eq("active", true).order("name"),
      ]);
      return {
        positions: positions.data ?? [],
        departments: departments.data ?? [],
        sectors: sectors.data ?? [],
      };
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (collaborators.data ?? []).forEach((c) => map.set(c.id, c.full_name));
    lookups.data?.positions.forEach((p) => map.set(p.id, p.name));
    lookups.data?.departments.forEach((d) => map.set(d.id, d.name));
    lookups.data?.sectors.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [collaborators.data, lookups.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (collaborators.data ?? []).filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.full_name, c.social_name, c.registration_number, c.cpf, c.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [collaborators.data, search, statusFilter]);

  const sectorOptions = useMemo(() => {
    const all = lookups.data?.sectors ?? [];
    if (form.department_id === NONE) return all;
    return all.filter((s) => !s.department_id || s.department_id === form.department_id);
  }, [lookups.data, form.department_id]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        registration_number: form.registration_number.trim(),
        full_name: form.full_name.trim(),
        social_name: nn(form.social_name),
        cpf: nn(form.cpf),
        phone: nn(form.phone),
        email: nn(form.email),
        birth_date: nn(form.birth_date),
        hire_date: nn(form.hire_date),
        position_id: ref(form.position_id),
        department_id: ref(form.department_id),
        sector_id: ref(form.sector_id),
        supervisor_id: ref(form.supervisor_id),
        status: form.status,
        is_driver: form.is_driver,
        driver_license_category: form.is_driver ? nn(form.driver_license_category) : null,
        driver_license_expiry: form.is_driver ? nn(form.driver_license_expiry) : null,
        notes: nn(form.notes),
      };
      const { error } = editing
        ? await supabase.from("collaborators").update(payload).eq("id", editing.id)
        : await supabase.from("collaborators").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Colaborador atualizado." : "Colaborador cadastrado.");
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("collaborators").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador excluído.");
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(c: Collaborator) {
    setEditing(c);
    setForm(toForm(c));
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colaboradores"
        description="Cadastro de colaboradores, vínculo com cargo, setor, departamento e supervisão."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/colaboradores/estrutura">
                <Settings2 className="h-4 w-4" />
                Cargos e setores
              </Link>
            </Button>
            {canWrite && (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                Novo colaborador
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, matrícula, CPF ou e-mail"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Somente ativos</SelectItem>
            <SelectItem value="inactive">Somente inativos</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matrícula</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Supervisor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collaborators.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Carregando colaboradores...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Nenhum colaborador encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.registration_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{c.social_name || c.full_name}</div>
                    {c.is_driver && (
                      <Badge variant="outline" className="mt-1">
                        Motorista {c.driver_license_category ? `· ${c.driver_license_category}` : ""}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{c.position_id ? nameById.get(c.position_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{c.sector_id ? nameById.get(c.sector_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{c.supervisor_id ? nameById.get(c.supervisor_id) ?? "—" : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(c)}>
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
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="registration">Matrícula *</Label>
              <Input id="registration" value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="social_name">Nome social</Label>
              <Input id="social_name" value={form.social_name} onChange={(e) => set("social_name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input id="cpf" value={form.cpf} onChange={(e) => set("cpf", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-c">E-mail</Label>
              <Input id="email-c" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth">Data de nascimento</Label>
              <Input id="birth" type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hire">Data de admissão</Label>
              <Input id="hire" type="date" value={form.hire_date} onChange={(e) => set("hire_date", e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Cargo</Label>
              <Select value={form.position_id} onValueChange={(v) => set("position_id", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não definido</SelectItem>
                  {lookups.data?.positions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Select
                value={form.department_id}
                onValueChange={(v) => setForm((f) => ({ ...f, department_id: v, sector_id: NONE }))}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não definido</SelectItem>
                  {lookups.data?.departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Setor</Label>
              <Select value={form.sector_id} onValueChange={(v) => set("sector_id", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não definido</SelectItem>
                  {sectorOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Supervisor</Label>
              <Select value={form.supervisor_id} onValueChange={(v) => set("supervisor_id", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não definido</SelectItem>
                  {(collaborators.data ?? [])
                    .filter((c) => c.status === "active" && c.id !== editing?.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as "active" | "inactive")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 pt-6">
              <Switch id="driver" checked={form.is_driver} onCheckedChange={(v) => set("is_driver", v)} />
              <Label htmlFor="driver">É motorista</Label>
            </div>

            {form.is_driver && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cnh">Categoria da CNH</Label>
                  <Input id="cnh" value={form.driver_license_category} onChange={(e) => set("driver_license_category", e.target.value)} placeholder="Ex.: D" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cnh-exp">Validade da CNH</Label>
                  <Input id="cnh-exp" type="date" value={form.driver_license_expiry} onChange={(e) => set("driver_license_expiry", e.target.value)} />
                </div>
              </>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !canWrite}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.full_name} será removido permanentemente. Registros vinculados podem impedir a exclusão —
              nesse caso, marque o colaborador como inativo.
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

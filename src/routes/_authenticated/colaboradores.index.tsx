import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Tabs as SubTabs, TabsContent as SubTabsContent, TabsList as SubTabsList, TabsTrigger as SubTabsTrigger } from "@/components/ui/tabs";
import { FuncoesPage } from "@/components/colaboradores/funcoes";
import { TurnosPage } from "@/components/colaboradores/turnos";
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
import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { createNameMatcher, emptyToNull, insertSequentially, normText, parseBool, parseDate, parseNum, titleCase, titleCaseOrNull } from "@/lib/import-helpers";

const CONTRACT_LABELS: Record<string, string> = {
  efetivo: "Efetivo",
  pj: "PJ",
  intermitente: "Intermitente",
};

const contractFromText = (v: string): "efetivo" | "pj" | "intermitente" | null => {
  const t = normText(v);
  if (!t) return null;
  if (t.startsWith("efet") || t.startsWith("clt")) return "efetivo";
  if (t.startsWith("pj") || t.includes("juridic")) return "pj";
  if (t.startsWith("interm")) return "intermitente";
  return null;
};

const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "matricula", required: true, hint: "Código/matrícula única.", example: "1024" },
  { key: "nome_completo", required: true, example: "Maria Aparecida Souza" },
  { key: "nome_social" },
  { key: "cpf", hint: "Somente números ou com pontuação.", example: "123.456.789-00" },
  { key: "rg", hint: "Número do RG.", example: "12.345.678-9" },
  { key: "telefone", example: "(11) 99999-0000" },
  { key: "email", example: "maria@empresa.com" },
  { key: "data_nascimento", hint: "AAAA-MM-DD ou DD/MM/AAAA.", example: "1990-05-12" },
  { key: "data_admissao", hint: "AAAA-MM-DD ou DD/MM/AAAA.", example: "2023-01-10" },
  { key: "funcao", hint: "Deve existir em Funções e departamentos. Aceita variações: sem acento, em CAIXA ALTA, no feminino ou no plural (Tecnica = Técnico). O nível faz parte da função: N1, N2, N3 e N4 são funções diferentes.", example: "Montador de Andaimes N1" },
  { key: "departamento", hint: "Deve existir em Funções e departamentos. Aceita variações de acento, maiúsculas e gênero.", example: "Serviços" },
  { key: "situacao", hint: "Ativo ou Inativo (padrão Ativo).", example: "Ativo" },
  { key: "motorista", hint: "Sim ou Não.", example: "Não" },
  { key: "cnh_categoria", example: "D" },
  { key: "cnh_validade", hint: "AAAA-MM-DD ou DD/MM/AAAA." },
  { key: "salario", hint: "Valor em reais, ex.: 3500,00.", example: "3500,00" },
  { key: "tipo_contrato", hint: "Efetivo, PJ ou Intermitente.", example: "Efetivo" },
  { key: "observacoes" },
];

export const Route = createFileRoute("/_authenticated/colaboradores/")({
  head: () => ({
    meta: [
      { title: "Colaboradores | Programação Operacional" },
      { name: "description", content: "Cadastro de colaboradores: dados pessoais, função, departamento, supervisão e habilitação de motorista." },
      { property: "og:title", content: "Colaboradores | Programação Operacional" },
      { property: "og:description", content: "Cadastro completo de colaboradores da operação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: ColabTab } =>
    s["tab"] === "funcoes" || s["tab"] === "turnos" ? { tab: s["tab"] } : {},
  component: ColabTabsPage,
});

type ColabTab = "colaboradores" | "funcoes" | "turnos";

function ColabTabsPage() {
  const { tab = "colaboradores" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SubTabs value={tab} onValueChange={(v) => navigate({ search: v === "colaboradores" ? {} : { tab: v as ColabTab }, replace: true })}>
      <SubTabsList>
        <SubTabsTrigger value="colaboradores">Colaboradores</SubTabsTrigger>
        <SubTabsTrigger value="funcoes">Funções</SubTabsTrigger>
        <SubTabsTrigger value="turnos">Turnos</SubTabsTrigger>
      </SubTabsList>
      <SubTabsContent value="colaboradores" className="mt-4"><CollaboratorsPage /></SubTabsContent>
      <SubTabsContent value="funcoes" className="mt-4"><FuncoesPage /></SubTabsContent>
      <SubTabsContent value="turnos" className="mt-4"><TurnosPage /></SubTabsContent>
    </SubTabs>
  );
}

type Collaborator = Tables<"collaborators">;

const NONE = "__none__";

const schema = z.object({
  registration_number: z.string().trim().min(1, "Informe a matrícula").max(30),
  full_name: z.string().trim().min(3, "Informe o nome completo").max(150),
  social_name: z.string().trim().max(150).optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  rg: z.string().trim().max(20).optional().or(z.literal("")),
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
  city: string;
  phone: string;
  email: string;
  birth_date: string;
  hire_date: string;
  position_id: string;
  department_id: string;
  
  status: "active" | "inactive";
  is_driver: boolean;
  vt_enabled: boolean;
  driver_license_category: string;
  driver_license_expiry: string;
  salary: string;
  contract_type: string;
  rg: string;
  notes: string;
};

const emptyForm: FormState = {
  registration_number: "",
  full_name: "",
  social_name: "",
  cpf: "",
  city: "",
  phone: "",
  email: "",
  birth_date: "",
  hire_date: "",
  position_id: NONE,
  department_id: NONE,
  
  status: "active",
  is_driver: false,
  vt_enabled: true,
  driver_license_category: "",
  driver_license_expiry: "",
  salary: "",
  contract_type: NONE,
  rg: "",
  notes: "",
};

function toForm(c: Collaborator): FormState {
  return {
    registration_number: c.registration_number ?? "",
    full_name: c.full_name ?? "",
    social_name: c.social_name ?? "",
    cpf: c.cpf ?? "",
    city: (c as { city?: string | null }).city ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    birth_date: c.birth_date ?? "",
    hire_date: c.hire_date ?? "",
    position_id: c.position_id ?? NONE,
    department_id: c.department_id ?? NONE,
    
    status: c.status,
    is_driver: c.is_driver,
    vt_enabled: (c as { vt_enabled?: boolean | null }).vt_enabled !== false,
    driver_license_category: c.driver_license_category ?? "",
    driver_license_expiry: c.driver_license_expiry ?? "",
    salary: c.salary == null ? "" : Number(c.salary).toFixed(2).replace(".", ","),
    contract_type: c.contract_type ?? NONE,
    rg: c.rg ?? "",
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
      const [positions, departments] = await Promise.all([
        supabase.from("positions").select("id, name, active").eq("active", true).order("name"),
        supabase.from("departments").select("id, name, active").eq("active", true).order("name"),
      ]);
      return {
        positions: positions.data ?? [],
        departments: departments.data ?? [],
      };
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (collaborators.data ?? []).forEach((c) => map.set(c.id, c.full_name));
    lookups.data?.positions.forEach((p) => map.set(p.id, p.name));
    lookups.data?.departments.forEach((d) => map.set(d.id, d.name));
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

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        registration_number: form.registration_number.trim(),
        full_name: form.full_name.trim(),
        social_name: nn(form.social_name),
        cpf: nn(form.cpf),
        city: titleCaseOrNull(form.city ?? ""),
        rg: nn(form.rg),
        salary: form.salary.trim() === "" ? null : Number(form.salary.replace(",", ".")),
        contract_type: form.contract_type === NONE ? null : (form.contract_type as "efetivo" | "pj" | "intermitente"),
        phone: nn(form.phone),
        email: nn(form.email),
        birth_date: nn(form.birth_date),
        hire_date: nn(form.hire_date),
        position_id: ref(form.position_id),
        department_id: ref(form.department_id),
        
        status: form.status,
        is_driver: form.is_driver,
        vt_enabled: form.vt_enabled,
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
      queryClient.invalidateQueries();
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
      queryClient.invalidateQueries();
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

  async function importCollaborators(rows: ImportRow[]) {
    const positions = createNameMatcher(lookups.data?.positions ?? []);
    const departments = createNameMatcher(lookups.data?.departments ?? []);
    const errors: string[] = [];
    const records: { line: number; values: Record<string, unknown> }[] = [];

    rows.forEach((r, i) => {
      const line = i + 2;
      if (!r["matricula"] || !r["nome_completo"]) {
        errors.push(`Linha ${line}: matrícula e nome completo são obrigatórios.`);
        return;
      }
      const resolve = (
        label: string,
        match: (v: string) => { id: string } | null,
        value?: string,
      ) => {
        const v = (value ?? "").trim();
        if (!v) return null;
        const found = match(v);
        if (!found) errors.push(`Linha ${line}: ${label} "${v}" não cadastrado(a).`);
        return found?.id ?? null;
      };
      records.push({
        line,
        values: {
          registration_number: r["matricula"]!.trim(),
          full_name: titleCase(r["nome_completo"]!),
          social_name: titleCaseOrNull(r["nome_social"] ?? ""),
          cpf: emptyToNull(r["cpf"] ?? ""),
          phone: emptyToNull(r["telefone"] ?? ""),
          email: emptyToNull(r["email"] ?? ""),
          birth_date: parseDate(r["data_nascimento"] ?? ""),
          hire_date: parseDate(r["data_admissao"] ?? ""),
          position_id: resolve("função", positions, r["funcao"]),
          department_id: resolve("departamento", departments, r["departamento"]),
          status: normText(r["situacao"] ?? "").startsWith("inat") ? "inactive" : "active",
          is_driver: parseBool(r["motorista"] ?? ""),
          driver_license_category: emptyToNull(r["cnh_categoria"] ?? ""),
          driver_license_expiry: parseDate(r["cnh_validade"] ?? ""),
          rg: emptyToNull(r["rg"] ?? ""),
          salary: parseNum(r["salario"] ?? ""),
          contract_type: contractFromText(r["tipo_contrato"] ?? ""),
          notes: emptyToNull(r["observacoes"] ?? ""),
        },
      });
    });

    const result = await insertSequentially(
      records,
      async (values) => {
        const { error } = await supabase.from("collaborators").insert(values as never);
        return { error };
      },
      errors,
    );
    await queryClient.invalidateQueries();
    return result;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colaboradores"
        description="Cadastro de colaboradores, vínculo com função, departamento e supervisão."
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <ImportDialog
                entity="colaboradores"
                description="Importe vários colaboradores de uma vez a partir de um arquivo .xlsx ou .csv."
                columns={IMPORT_COLUMNS}
                onImport={importCollaborators}
              />
            )}
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
              <TableHead>Função</TableHead>
              <TableHead>Departamento</TableHead>
              
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collaborators.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Carregando colaboradores...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
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
                    {c.contract_type && (
                      <Badge variant="secondary" className="mt-1 ml-1">
                        {CONTRACT_LABELS[c.contract_type] ?? c.contract_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{c.position_id ? nameById.get(c.position_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{c.department_id ? nameById.get(c.department_id) ?? "—" : "—"}</TableCell>
                  
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
                    {canWrite && (
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
              <Label htmlFor="cpf">CPF</Label>
              <Input id="cpf" value={form.cpf} onChange={(e) => set("cpf", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
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
              <Label>Função</Label>
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
                onValueChange={(v) => set("department_id", v)}
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
              <Label>Situação</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as "active" | "inactive")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-6 pt-6">
              <div className="flex items-center gap-3">
                <Switch id="driver" checked={form.is_driver} onCheckedChange={(v) => set("is_driver", v)} />
                <Label htmlFor="driver">É motorista</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="vt_enabled" checked={form.vt_enabled} onCheckedChange={(v) => set("vt_enabled", v)} />
                <Label htmlFor="vt_enabled">Vale Transporte</Label>
              </div>
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

            <div className="space-y-2">
              <Label htmlFor="rg">RG</Label>
              <Input id="rg" value={form.rg} onChange={(e) => set("rg", e.target.value)} placeholder="12.345.678-9" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="salary">Valor hora (R$)</Label>
              <Input
                id="salary"
                inputMode="decimal"
                value={form.salary}
                onChange={(e) => set("salary", e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="11,22"
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de contrato</Label>
              <Select value={form.contract_type} onValueChange={(v) => set("contract_type", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não definido</SelectItem>
                  <SelectItem value="efetivo">Efetivo</SelectItem>
                  <SelectItem value="pj">PJ</SelectItem>
                  <SelectItem value="intermitente">Intermitente</SelectItem>
                </SelectContent>
              </Select>
            </div>


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

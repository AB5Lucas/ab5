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
import { createNameMatcher, emptyToNull, normText, parseDate } from "@/lib/import-helpers";
import { addDays, expiryFrom, formatDateBR, todayISO, INTEGRATION_WARN_DAYS } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/obras/integracoes")({
  head: () => ({
    meta: [
      { title: "Integrações | Programação Operacional" },
      {
        name: "description",
        content:
          "Cadastro e controle das integrações dos colaboradores com os clientes: datas, validade e status.",
      },
      { property: "og:title", content: "Integrações | Programação Operacional" },
      {
        property: "og:description",
        content: "Controle das integrações dos colaboradores com os clientes da empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

type Row = {
  id: string;
  collaborator_id: string;
  client_id: string;
  integration_date: string;
  expires_at: string | null;
  notes: string | null;
};

type Status = "valid" | "expiring" | "expired";

const STATUS_LABEL: Record<Status, string> = {
  valid: "Válida",
  expiring: "Próxima do vencimento",
  expired: "Vencida",
};

const onlyDigits = (v: string) => (v ?? "").replace(/\D/g, "");

function statusOf(expires: string | null, today: string): Status {
  if (!expires) return "valid";
  if (expires < today) return "expired";
  if (expires <= addDays(today, INTEGRATION_WARN_DAYS)) return "expiring";
  return "valid";
}

const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "matricula", required: true, hint: "Identifica o colaborador já cadastrado.", example: "1024" },
  { key: "cliente", required: true, hint: "Nome do cliente já cadastrado.", example: "Cristália" },
  { key: "data_integracao", required: true, hint: "AAAA-MM-DD ou DD/MM/AAAA.", example: "2026-01-15" },
  { key: "validade", hint: "Data de vencimento. Em branco = calculada automaticamente (1 ano − 1 dia).", example: "2027-01-15" },
  { key: "observacoes" },
];

const schema = z.object({
  collaborator_id: z.string().uuid("Selecione o colaborador"),
  client_id: z.string().uuid("Selecione o cliente"),
  integration_date: z.string().min(10, "Informe a data da integração"),
});

type FormState = {
  collaborator_id: string;
  client_id: string;
  integration_date: string;
  expires_at: string;
  notes: string;
};

const emptyForm: FormState = {
  collaborator_id: "",
  client_id: "",
  integration_date: todayISO(),
  expires_at: "",
  notes: "",
};

function IntegrationsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const scheduled = useScheduled("integracao");
  const inConf = useInConference("integracao");
  const qc = useQueryClient();
  const today = todayISO();

  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [personQuery, setPersonQuery] = useState("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const integrations = useQuery({
    queryKey: ["client-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_integrations")
        .select("id, collaborator_id, client_id, integration_date, expires_at, notes")
        .order("integration_date", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  const collaborators = useQuery({
    queryKey: ["collaborators-min-active-int"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, cpf, registration_number, position_id")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
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
      { id: string; full_name: string; cpf: string | null; registration_number: string | null; position_id: string | null }
    >();
    (collaborators.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [collaborators.data]);

  const clientById = useMemo(() => {
    const m = new Map<string, string>();
    (clients.data ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients.data]);

  const positionById = useMemo(() => {
    const m = new Map<string, string>();
    (positions.data ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [positions.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = onlyDigits(search);
    return (integrations.data ?? []).filter((r) => {
      const p = personById.get(r.collaborator_id);
      if (!p) return false;
      const clientName = clientById.get(r.client_id) ?? "";
      if (clientFilter !== "all" && r.client_id !== clientFilter) return false;
      if (statusFilter !== "all" && statusOf(r.expires_at, today) !== statusFilter) return false;
      if (q) {
        const hit =
          (p?.full_name ?? "").toLowerCase().includes(q) ||
          clientName.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && onlyDigits(p?.cpf ?? "").includes(qDigits));
        if (!hit) return false;
      }
      return true;
    });
  }, [integrations.data, search, clientFilter, statusFilter, personById, clientById, today]);

  const summary = useMemo(() => {
    const s = { total: filtered.length, valid: 0, expiring: 0, expired: 0 };
    filtered.forEach((r) => {
      const st = statusOf(r.expires_at, today);
      if (st === "valid") s.valid++;
      else if (st === "expiring") s.expiring++;
      else s.expired++;
    });
    return s;
  }, [filtered, today]);

  const peopleOptions = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    const qd = onlyDigits(personQuery);
    const list = collaborators.data ?? [];
    if (!q) return list.slice(0, 50);
    return list
      .filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) || (qd.length >= 3 && onlyDigits(p.cpf ?? "").includes(qd)),
      )
      .slice(0, 50);
  }, [collaborators.data, personQuery]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        collaborator_id: form.collaborator_id,
        client_id: form.client_id,
        integration_date: form.integration_date,
        expires_at: form.expires_at || (form.integration_date ? expiryFrom(form.integration_date, 12) : null),
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("client_integrations").update(payload).eq("id", editing.id);
        if (error) throw error;
        return;
      }
      const dup = (integrations.data ?? []).find(
        (r) => r.collaborator_id === payload.collaborator_id && r.client_id === payload.client_id,
      );
      if (dup) {
        const { error } = await supabase.from("client_integrations").update(payload).eq("id", dup.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("client_integrations").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Integração atualizada" : "Integração salva");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["client-integrations"] });
      qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("client_integrations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Integração excluída");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["client-integrations"] });
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
    setForm({
      collaborator_id: r.collaborator_id,
      client_id: r.client_id,
      integration_date: r.integration_date,
      expires_at: r.expires_at ?? "",
      notes: r.notes ?? "",
    });
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
    const matchClient = createNameMatcher(clients.data ?? []);
    const existing = new Map<string, string>(
      (integrations.data ?? []).map((r) => [`${r.collaborator_id}|${r.client_id}`, r.id]),
    );
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
      const client = matchClient(r["cliente"] ?? "");
      if (!client) {
        errors.push(`Linha ${line}: cliente "${r["cliente"] ?? ""}" não está cadastrado.`);
        continue;
      }
      const date = parseDate(r["data_integracao"] ?? "");
      if (!date) {
        errors.push(`Linha ${line}: data da integração inválida.`);
        continue;
      }
      const expires = r["validade"] ? parseDate(r["validade"]!) : date ? expiryFrom(date, 12) : null;
      if (r["validade"] && !expires) {
        errors.push(`Linha ${line}: data de validade inválida.`);
        continue;
      }
      const key = `${personId}|${client.id}`;
      if (seen.has(key)) {
        errors.push(`Linha ${line}: registro repetido na planilha para o mesmo colaborador e cliente.`);
        continue;
      }
      seen.add(key);

      const payload = {
        collaborator_id: personId,
        client_id: client.id,
        integration_date: date,
        expires_at: expires,
        notes: emptyToNull(r["observacoes"] ?? ""),
      };
      const dupId = existing.get(key);
      const { error } = dupId
        ? await supabase.from("client_integrations").update(payload).eq("id", dupId)
        : await supabase.from("client_integrations").insert(payload);
      if (error) errors.push(`Linha ${line}: ${error.message}`);
      else inserted++;
    }

    await qc.invalidateQueries({ queryKey: ["client-integrations"] });
    await qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    return { inserted, errors };
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrações"
        description="Aptidão dos colaboradores para trabalhar em cada cliente. Serviços do mesmo cliente aproveitam a mesma integração."
        actions={
          <div className="flex flex-wrap gap-2">
            <AppointmentDialog type="integracao" />
            {canWrite && (
              <ImportDialog
                entity="integrações"
                description="Importe as integrações em massa. O colaborador é identificado pela matrícula e o cliente pelo nome já cadastrado."
                columns={IMPORT_COLUMNS}
                onImport={importRows}
              />
            )}
            {canWrite && (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" /> Nova integração
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">Total: {summary.total}</Badge>
        <Badge variant="outline">Válidas: {summary.valid}</Badge>
        <Badge variant="secondary">Próximas do vencimento: {summary.expiring}</Badge>
        <Badge variant="destructive">Vencidas: {summary.expired}</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome, CPF ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {(clients.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="valid">Válida</SelectItem>
            <SelectItem value="expiring">Próxima do vencimento</SelectItem>
            <SelectItem value="expired">Vencida</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead className="hidden lg:table-cell">Função</TableHead>
              <TableHead>Cliente</TableHead>
              
              <TableHead className="hidden md:table-cell">Integração</TableHead>
              <TableHead className="hidden md:table-cell">Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!integrations.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Nenhuma integração encontrada.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const p = personById.get(r.collaborator_id);
              const st = statusOf(r.expires_at, today);
              
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{p?.full_name ?? "—"}{(scheduled.has(`${r.collaborator_id}|${r.client_id}`)) && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">Agendado</Badge>}{inConf.has(`${r.collaborator_id}|${r.client_id}`) && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">Conferência</Badge>}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {p?.position_id ? positionById.get(p.position_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell>{clientById.get(r.client_id) ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateBR(r.integration_date)}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateBR(r.expires_at)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={st === "valid" ? "outline" : st === "expiring" ? "secondary" : "destructive"}
                    >
                      {STATUS_LABEL[st]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <AppointmentDialog
                        type="integracao"
                        iconOnly
                        initialValues={{ collaborator_id: r.collaborator_id, client_id: r.client_id }}
                      />
                      {canWrite && (
                        <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => setDeleting(r)}>
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar integração" : "Nova integração"}</DialogTitle>
            <DialogDescription>
              A integração é do cliente: vale para todos os serviços vinculados a ele.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Colaborador *</Label>
              <Input
                placeholder="Pesquisar por nome ou CPF"
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
                      {p.full_name}
                      {p.cpf ? ` — ${p.cpf}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data da integração *</Label>
              <Input
                type="date"
                value={form.integration_date}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, integration_date: v, expires_at: v ? expiryFrom(v, 12) : f.expires_at }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Validade</Label>
              <Input type="date" value={form.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
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

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Integração</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Colaborador: </span>
                {personById.get(viewing.collaborator_id)?.full_name ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">CPF: </span>
                {personById.get(viewing.collaborator_id)?.cpf || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Cliente: </span>
                {clientById.get(viewing.client_id) ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Integração: </span>
                {formatDateBR(viewing.integration_date)}
              </p>
              <p>
                <span className="text-muted-foreground">Validade: </span>
                {formatDateBR(viewing.expires_at)}
              </p>
              <p>
                <span className="text-muted-foreground">Status: </span>
                {STATUS_LABEL[statusOf(viewing.expires_at, today)]}
              </p>
              <p>
                <span className="text-muted-foreground">Observações: </span>
                {viewing.notes || "—"}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir integração?</AlertDialogTitle>
            <AlertDialogDescription>
              A integração de {deleting ? personById.get(deleting.collaborator_id)?.full_name ?? "—" : ""} com o
              cliente {deleting ? clientById.get(deleting.client_id) ?? "—" : ""} será removida. O colaborador
              deixará de ser considerado apto para os serviços desse cliente.
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

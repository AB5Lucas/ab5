import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CadastrosTabs } from "@/components/cadastros-tabs";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";
import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { emptyToNull, insertSequentially, parseBool, parseNum, titleCase, titleCaseOrNull } from "@/lib/import-helpers";

type Client = Tables<"clients">;

const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "nome", required: true, example: "Enel" },
  { key: "endereco", example: "Rua das Palmeiras" },
  { key: "numero", example: "150" },
  { key: "bairro" },
  { key: "cidade", example: "Campinas" },
  { key: "uf", hint: "2 letras.", example: "SP" },
  { key: "cep", example: "13000-000" },
  { key: "distancia_km", hint: "Número, use vírgula ou ponto.", example: "85,5" },
  { key: "exige_integracao", hint: "sim ou nao. Em branco = sim.", example: "sim" },
  { key: "observacoes" },
];

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes | Programação Operacional" },
      { name: "description", content: "Cadastro de clientes: endereço, cidade, distância e observações." },
      { property: "og:title", content: "Clientes | Programação Operacional" },
      { property: "og:description", content: "Cadastro de clientes, endereços e distâncias." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientsPage,
});

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente").max(150),
  state: z.string().trim().max(2, "UF com 2 letras").optional().or(z.literal("")),
});

type FormState = {
  name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  distance_km: string;
  notes: string;
  requires_integration: boolean;
  needs_company_transport: boolean;
  needs_transport_voucher: boolean;
  has_toll: boolean;
  toll_amount: string;
  trips_per_day: string;
  cc_prefix: string;
};

const emptyForm: FormState = {
  name: "",
  address: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  distance_km: "",
  notes: "",
  requires_integration: true,
  needs_company_transport: false,
  needs_transport_voucher: false,
  has_toll: false,
  toll_amount: "",
  trips_per_day: "1",
  cc_prefix: "",
};

const nn = (v: string) => (v.trim() === "" ? null : v.trim());

function ClientsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [addressSource, setAddressSource] = useState("");
  const [deleting, setDeleting] = useState<Client | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.data ?? [];
    return (clients.data ?? []).filter((c) =>
      [c.name, c.city, c.neighborhood].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [clients.data, search]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      if (form.cc_prefix.trim() && !/^\d{4}$/.test(form.cc_prefix.trim())) throw new Error("Prefixo CC deve ter 4 números");
      const payload = {
        name: form.name.trim(),
        address: nn(form.address),
        number: nn(form.number),
        neighborhood: nn(form.neighborhood),
        city: nn(form.city),
        state: nn(form.state)?.toUpperCase() ?? null,
        zip_code: nn(form.zip_code),
        distance_km: form.distance_km.trim() === "" ? null : Number(form.distance_km),
        notes: nn(form.notes),
        requires_integration: form.requires_integration,
        needs_company_transport: form.needs_company_transport,
        needs_transport_voucher: form.needs_transport_voucher,
        has_toll: form.has_toll,
        toll_amount: form.has_toll ? Number(form.toll_amount.replace(",", ".")) || 0 : 0,
        trips_per_day: Math.max(1, Number(form.trips_per_day) || 1),
        cc_prefix: nn(form.cc_prefix),
      };
      if (editing) {
        const { error } = await supabase.from("clients").update(payload).eq("id", editing.id);
        if (error) throw error;
        if (Number(editing.distance_km ?? 0) !== Number(payload.distance_km ?? 0)) {
          await supabase
            .from("vehicle_schedules")
            .update({ km: Number(payload.distance_km ?? 0) })
            .eq("client_id", editing.id)
            .eq("is_external", false)
            .eq("is_maintenance", false)
            .eq("is_suzano_local", false);
          queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
          queryClient.invalidateQueries({ queryKey: ["km-report"] });
        }
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente excluído");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setAddressSource("");
    setOpen(true);
  }

  function copyAddress(clientId: string) {
    const source = clients.data?.find((c) => c.id === clientId);
    if (!source) return;
    setAddressSource(clientId);
    setForm((current) => ({
      ...current,
      address: source.address ?? "",
      number: source.number ?? "",
      neighborhood: source.neighborhood ?? "",
      city: source.city ?? "",
      state: source.state ?? "",
      zip_code: source.zip_code ?? "",
    }));
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      name: c.name ?? "",
      address: c.address ?? "",
      number: c.number ?? "",
      neighborhood: c.neighborhood ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      zip_code: c.zip_code ?? "",
      distance_km: c.distance_km != null ? String(c.distance_km) : "",
      notes: c.notes ?? "",
      requires_integration: c.requires_integration ?? true,
      needs_company_transport: c.needs_company_transport ?? false,
      needs_transport_voucher: c.needs_transport_voucher ?? false,
      has_toll: c.has_toll ?? false,
      toll_amount: c.toll_amount != null ? String(c.toll_amount) : "",
      trips_per_day: String(c.trips_per_day ?? 1),
      cc_prefix: c.cc_prefix ?? "",
    });
    setOpen(true);
  }

  async function importClients(rows: ImportRow[]) {
    const errors: string[] = [];
    const recs: { line: number; values: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      if (!r["nome"]) {
        errors.push(`Linha ${line}: nome é obrigatório.`);
        return;
      }
      recs.push({
        line,
        values: {
          name: titleCase(r["nome"]!),
          address: titleCaseOrNull(r["endereco"] ?? ""),
          number: emptyToNull(r["numero"] ?? ""),
          neighborhood: titleCaseOrNull(r["bairro"] ?? ""),
          city: titleCaseOrNull(r["cidade"] ?? ""),
          state: emptyToNull((r["uf"] ?? "").toUpperCase()),
          zip_code: emptyToNull(r["cep"] ?? ""),
          distance_km: parseNum(r["distancia_km"] ?? ""),
          notes: emptyToNull(r["observacoes"] ?? ""),
          requires_integration: (r["exige_integracao"] ?? "").trim() === "" ? true : parseBool(r["exige_integracao"]!),
        },
      });
    });
    const result = await insertSequentially(
      recs,
      async (values) => {
        const { error } = await supabase.from("clients").insert(values as never);
        return { error };
      },
      errors,
    );
    await queryClient.invalidateQueries({ queryKey: ["clients"] });
    return result;
  }

  return (
    <div className="space-y-4">
      <CadastrosTabs active="clientes" />
      <PageHeader
        title="Cadastros"
        description="Cadastro de clientes: endereço, cidade e distância utilizada nos serviços."
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <ImportDialog
                entity="clientes"
                description="Importe vários clientes de uma vez a partir de um arquivo .xlsx ou .csv."
                columns={IMPORT_COLUMNS}
                onImport={importClients}
              />
            )}
            {canWrite && (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" /> Novo cliente
              </Button>
            )}
          </div>
        }
      />

      <div className="relative min-w-52">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Buscar por nome, cidade ou bairro"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Prefixo CC</TableHead>
              <TableHead className="hidden md:table-cell">Endereço</TableHead>
              <TableHead className="hidden lg:table-cell">Cidade</TableHead>
              <TableHead className="hidden lg:table-cell">Distância</TableHead>
              <TableHead>Integração</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!clients.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="font-mono">{c.cc_prefix ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {[c.address, c.number, c.neighborhood].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {[c.city, c.state].filter(Boolean).join("/") || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {c.distance_km != null ? `${c.distance_km} km` : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={c.requires_integration ? "outline" : "secondary"} className="text-[10px]">
                      {c.requires_integration ? "Exige integração" : "Não exige"}
                    </Badge>
                    {c.needs_company_transport && (
                      <Badge className="text-[10px]">Transporte da empresa</Badge>
                    )}
                    {false && c.needs_transport_voucher && (
                      <Badge variant="secondary" className="text-[10px]">Vale-transporte</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {canWrite && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Editar cliente">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canWrite && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Excluir cliente">
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
            <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Nome do cliente *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Prefixo CC (4 números)</Label>
              <Input inputMode="numeric" maxLength={4} placeholder="Ex.: 2004" value={form.cc_prefix} onChange={(e) => set("cc_prefix", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              {!editing && (
                <div className="mb-3 space-y-1">
                  <Label htmlFor="copy-client-address">Copiar endereço de outro cliente</Label>
                  <Select value={addressSource} onValueChange={copyAddress} disabled={!clients.data?.length}>
                    <SelectTrigger id="copy-client-address">
                      <SelectValue placeholder="Selecionar cliente cadastrado" />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients.data ?? []).map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
              <Label>Distância de ida (km)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.distance_km}
                onChange={(e) => set("distance_km", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Somente a ida; o sistema considera o dobro (ida e volta).</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="has-toll">Tem pedágio?</Label>
                <p className="text-xs text-muted-foreground">Informe o valor da ida; o sistema dobra para ida e volta.</p>
              </div>
              <Switch id="has-toll" checked={form.has_toll} onCheckedChange={(v) => set("has_toll", v)} />
            </div>
            {form.has_toll && (
              <div className="space-y-1 sm:col-span-2">
                <Label>Valor do pedágio por ida (R$)</Label>
                <Input value={form.toll_amount} onChange={(e) => set("toll_amount", e.target.value)} />
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="requires-integration">Exige integração</Label>
                <p className="text-xs text-muted-foreground">
                  Desligue para clientes em que o colaborador pode ser escalado sem integração (ex.: Indústria).
                </p>
              </div>
              <Switch
                id="requires-integration"
                checked={form.requires_integration}
                onCheckedChange={(v) => set("requires_integration", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="needs-company-transport">Necessita de transporte da empresa?</Label>
                <p className="text-xs text-muted-foreground">
                  Gera necessidade de vagas na frota.
                </p>
              </div>
              <Switch
                id="needs-company-transport"
                checked={form.needs_company_transport}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, needs_company_transport: v, needs_transport_voucher: false }))
                }
              />
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
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente "{deleting?.name}" será removido permanentemente. Os serviços vinculados ficarão sem cliente.
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

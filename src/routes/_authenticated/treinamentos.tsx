import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/treinamentos")({
  head: () => ({
    meta: [
      { title: "Treinamentos | Programação Operacional" },
      { name: "description", content: "Catálogo de treinamentos e controle de validade por colaborador." },
      { property: "og:title", content: "Treinamentos | Programação Operacional" },
      { property: "og:description", content: "Catálogo de treinamentos e controle de validade por colaborador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrainingsPage,
});

import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { AppointmentDialog } from "@/components/appointment-dialog";
import { createNameMatcher, emptyToNull, insertSequentially, normText, parseDate } from "@/lib/import-helpers";

const RECORD_COLUMNS: ImportColumn[] = [
  { key: "matricula", hint: "Matrícula do colaborador (use matrícula ou nome).", example: "1024" },
  { key: "colaborador", hint: "Nome completo, usado se a matrícula estiver vazia. Aceita variações de acento e maiúsculas." },
  { key: "treinamento", required: true, hint: "Nome do treinamento do catálogo. Aceita variações: sem acento, CAIXA ALTA, plural ou pequenas diferenças de escrita.", example: "NR-10" },
  { key: "descricao", hint: "Use quando existir mais de um treinamento com o mesmo nome (ex.: NR18 Civil x NR18 Andaimes).", example: "Andaimes" },
  { key: "data_realizacao", required: true, hint: "AAAA-MM-DD ou DD/MM/AAAA.", example: "2026-03-01" },
  { key: "data_vencimento", hint: "Se vazio, é calculado pela validade do treinamento." },
  { key: "documento_url", hint: "Link do certificado/documento.", example: "https://..." },
];

import { formatDateBR } from "@/lib/scheduling";

const today = () => new Date().toISOString().slice(0, 10);

function addMonths(dateStr: string, months: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function statusOf(expires: string | null): "valid" | "expiring" | "expired" {
  if (!expires) return "valid";
  const days = Math.floor((new Date(`${expires}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

const STATUS_LABEL = { valid: "Válido", expiring: "A vencer", expired: "Vencido" } as const;

/** Um colaborador tem apenas um registro por treinamento: se já existir, atualiza em vez de duplicar. */
async function upsertTrainingRecord(values: {
  collaborator_id: string;
  training_id: string;
  completed_at: string;
  expires_at: string | null;
  document_url: string | null;
}) {
  const { data: existing, error: findError } = await supabase
    .from("collaborator_trainings")
    .select("id")
    .eq("collaborator_id", values.collaborator_id)
    .eq("training_id", values.training_id)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) return { error: findError };

  if (existing) {
    const { error } = await supabase
      .from("collaborator_trainings")
      .update({
        completed_at: values.completed_at,
        expires_at: values.expires_at,
        document_url: values.document_url,
      })
      .eq("id", existing.id);
    return { error };
  }
  const { error } = await supabase.from("collaborator_trainings").insert(values);
  return { error };
}

function TrainingsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const qc = useQueryClient();

  const trainings = useQuery({
    queryKey: ["trainings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trainings").select("*").order("name");
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

  const records = useQuery({
    queryKey: ["collaborator-trainings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborator_trainings")
        .select("*")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (people.data ?? []).forEach((p) => m.set(p.id, p.full_name));
    (trainings.data ?? []).forEach((t) => m.set(t.id, t.description ? `${t.name} — ${t.description}` : t.name));
    return m;
  }, [people.data, trainings.data]);

  // --- catálogo -------------------------------------------------------------
  const [tName, setTName] = useState("");
  const [tDesc, setTDesc] = useState("");
  const [tMonths, setTMonths] = useState("12");

  const createTraining = useMutation({
    mutationFn: async () => {
      const name = tName.trim();
      if (name.length < 2) throw new Error("Informe o nome do treinamento");
      const months = Number(tMonths);
      if (!Number.isFinite(months) || months <= 0) throw new Error("Validade inválida");
      const { error } = await supabase.from("trainings").insert({
        name,
        description: tDesc.trim() || null,
        validity_months: months,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTName("");
      setTDesc("");
      setTMonths("12");
      toast.success("Treinamento criado.");
      qc.invalidateQueries({ queryKey: ["trainings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTraining = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("trainings").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trainings"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTraining = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trainings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Treinamento excluído.");
      qc.invalidateQueries({ queryKey: ["trainings"] });
    },
    onError: () => toast.error("Não foi possível excluir: existem registros vinculados."),
  });

  // --- registros ------------------------------------------------------------
  const [open, setOpen] = useState(false);
  const [rPerson, setRPerson] = useState("");
  const [rTraining, setRTraining] = useState("");
  const [rDate, setRDate] = useState(today());
  const [rDoc, setRDoc] = useState("");
  const [filter, setFilter] = useState<"all" | "valid" | "expiring" | "expired">("all");
  const [personSearch, setPersonSearch] = useState("");
  const [trainingIds, setTrainingIds] = useState<string[]>([]);

  const addRecord = useMutation({
    mutationFn: async () => {
      if (!rPerson) throw new Error("Selecione o colaborador");
      if (!rTraining) throw new Error("Selecione o treinamento");
      const training = (trainings.data ?? []).find((t) => t.id === rTraining);
      const expires = training?.validity_months ? addMonths(rDate, training.validity_months) : null;
      const { error } = await upsertTrainingRecord({
        collaborator_id: rPerson,
        training_id: rTraining,
        completed_at: rDate,
        expires_at: expires,
        document_url: rDoc.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Treinamento registrado.");
      setOpen(false);
      setRPerson("");
      setRTraining("");
      setRDate(today());
      setRDoc("");
      qc.invalidateQueries({ queryKey: ["collaborator-trainings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("collaborator_trainings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro removido.");
      qc.invalidateQueries({ queryKey: ["collaborator-trainings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Colaboradores que possuem TODOS os treinamentos selecionados. */
  const peopleWithAll = useMemo(() => {
    if (trainingIds.length === 0) return null;
    const byPerson = new Map<string, Set<string>>();
    for (const r of records.data ?? []) {
      const set = byPerson.get(r.collaborator_id) ?? new Set<string>();
      set.add(r.training_id);
      byPerson.set(r.collaborator_id, set);
    }
    const ok = new Set<string>();
    byPerson.forEach((set, person) => {
      if (trainingIds.every((id) => set.has(id))) ok.add(person);
    });
    return ok;
  }, [records.data, trainingIds]);

  const filtered = (records.data ?? []).filter((r) => {
    if (filter !== "all" && statusOf(r.expires_at) !== filter) return false;
    const p = normText(personSearch);
    if (p && !normText(nameById.get(r.collaborator_id) ?? "").includes(p)) return false;
    if (peopleWithAll) {
      if (!peopleWithAll.has(r.collaborator_id)) return false;
      if (!trainingIds.includes(r.training_id)) return false;
    }
    return true;
  });

  async function importRecords(rows: ImportRow[]) {
    const errors: string[] = [];
    const { data: allPeople } = await supabase.from("collaborators").select("id, full_name, registration_number");
    const byReg = new Map((allPeople ?? []).map((p) => [normText(p.registration_number ?? ""), p.id]));
    const matchPerson = createNameMatcher((allPeople ?? []).map((p) => ({ id: p.id, name: p.full_name })));
    const catalog = trainings.data ?? [];
    /** Quando há vários treinamentos com o mesmo nome (ex.: NR18), a descrição decide qual é. */
    const findTraining = (name: string, desc: string) => {
      const sameName = catalog.filter((t) => createNameMatcher([t])(name));
      if (sameName.length <= 1) return sameName[0] ?? createNameMatcher(catalog)(name) ?? null;
      const d = normText(desc ?? "");
      if (!d) return null;
      return (
        sameName.find((t) => normText(t.description ?? "") === d) ??
        sameName.find((t) => normText(t.description ?? "").includes(d) || d.includes(normText(t.description ?? ""))) ??
        null
      );
    };

    const recs: { line: number; values: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      const reg = (r["matricula"] ?? "").trim();
      const person = reg
        ? byReg.get(normText(reg))
        : matchPerson(r["colaborador"] ?? "")?.id;
      if (!person) {
        errors.push(`Linha ${line}: colaborador não encontrado (${reg || r["colaborador"] || "vazio"}).`);
        return;
      }
      const training = findTraining(r["treinamento"] ?? "", r["descricao"] ?? "");
      if (!training) {
        errors.push(
          `Linha ${line}: treinamento "${r["treinamento"] ?? ""}" não encontrado no catálogo (se houver mais de um com esse nome, preencha a coluna descricao).`,
        );
        return;
      }
      const done = parseDate(r["data_realizacao"] ?? "");
      if (!done) {
        errors.push(`Linha ${line}: data de realização inválida.`);
        return;
      }
      const expires =
        parseDate(r["data_vencimento"] ?? "") ??
        (training.validity_months ? addMonths(done, training.validity_months) : null);
      recs.push({
        line,
        values: {
          collaborator_id: person,
          training_id: training.id,
          completed_at: done,
          expires_at: expires,
          document_url: emptyToNull(r["documento_url"] ?? ""),
        },
      });
    });
    const result = await insertSequentially(
      recs,
      async (values) => {
        const { error } = await upsertTrainingRecord(values as Parameters<typeof upsertTrainingRecord>[0]);
        return { error };
      },
      errors,
    );
    await qc.invalidateQueries({ queryKey: ["collaborator-trainings"] });
    return result;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Treinamentos"
        description="Catálogo de treinamentos e controle de validade por colaborador."
        actions={
          canWrite && (
            <div className="flex flex-wrap gap-2">
              <AppointmentDialog type="treinamento" />
              <ImportDialog
                entity="registros de treinamentos"
                description="Importe treinamentos realizados e seus documentos (.xlsx ou .csv)."
                columns={RECORD_COLUMNS}
                onImport={importRecords}
              />
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> Registrar treinamento
              </Button>
            </div>
          )
        }
      />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Registros</TabsTrigger>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Colaborador</Label>
              <Input value={personSearch} onChange={(e) => setPersonSearch(e.target.value)} placeholder="Buscar colaborador" />
            </div>
            <div className="space-y-1">
              <Label>Treinamento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    <span className="truncate">
                      {trainingIds.length === 0
                        ? "Todos os treinamentos"
                        : trainingIds.length === 1
                          ? nameById.get(trainingIds[0] ?? "") ?? "1 selecionado"
                          : `${trainingIds.length} selecionados`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-h-72 w-72 overflow-y-auto p-2">
                  {(trainings.data ?? []).filter((t) => t.active).map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                      <Checkbox
                        checked={trainingIds.includes(t.id)}
                        onCheckedChange={(c) =>
                          setTrainingIds((prev) => (c ? [...prev, t.id] : prev.filter((x) => x !== t.id)))
                        }
                      />
                      <span className="truncate">{t.name}{t.description ? ` · ${t.description}` : ""}</span>
                    </label>
                  ))}
                  {trainingIds.length > 0 && (
                    <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setTrainingIds([])}>
                      Limpar seleção
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>Situação</Label>
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="valid">Válidos</SelectItem>
                  <SelectItem value="expiring">A vencer (30 dias)</SelectItem>
                  <SelectItem value="expired">Vencidos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Treinamento</TableHead>
                  <TableHead className="hidden md:table-cell">Realizado</TableHead>
                  <TableHead className="hidden md:table-cell">Vencimento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">Nenhum registro encontrado.</TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const st = statusOf(r.expires_at);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{nameById.get(r.collaborator_id) ?? "—"}{scheduled.has(`${r.collaborator_id}|${r.training_id}`) && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">Agendado</Badge>}</TableCell>
                        <TableCell>{nameById.get(r.training_id) ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{formatDateBR(r.completed_at)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {r.expires_at ? formatDateBR(r.expires_at) : "Sem validade"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={st === "expired" ? "destructive" : st === "expiring" ? "secondary" : "default"}>
                            {STATUS_LABEL[st]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdmin && (
                            <Button variant="ghost" size="icon" aria-label="Remover registro" onClick={() => removeRecord.mutate(r.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="t-name">Novo treinamento</Label>
                <Input id="t-name" value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Ex.: NR-10" />
              </div>
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="t-desc">Descrição</Label>
                <Input id="t-desc" value={tDesc} onChange={(e) => setTDesc(e.target.value)} />
              </div>
              <div className="w-32 space-y-2">
                <Label htmlFor="t-months">Validade (meses)</Label>
                <Input id="t-months" type="number" min={1} value={tMonths} onChange={(e) => setTMonths(e.target.value)} />
              </div>
              <Button onClick={() => createTraining.mutate()} disabled={createTraining.isPending}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
          )}

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">Descrição</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainings.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (trainings.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhum treinamento cadastrado.</TableCell>
                  </TableRow>
                ) : (
                  (trainings.data ?? []).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="hidden md:table-cell">{t.description || "—"}</TableCell>
                      <TableCell>{t.validity_months} meses</TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Switch checked={t.active} onCheckedChange={(v) => toggleTraining.mutate({ id: t.id, active: v })} />
                        ) : (
                          <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Ativo" : "Inativo"}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button variant="ghost" size="icon" aria-label="Excluir treinamento" onClick={() => removeTraining.mutate(t.id)}>
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
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar treinamento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Colaborador *</Label>
              <Select value={rPerson} onValueChange={setRPerson}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Treinamento *</Label>
              <Select value={rTraining} onValueChange={setRTraining}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(trainings.data ?? []).filter((t) => t.active).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.description ? ` — ${t.description}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data de realização</Label>
              <Input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Link do certificado (opcional)</Label>
              <Input value={rDoc} onChange={(e) => setRDoc(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => addRecord.mutate()} disabled={addRecord.isPending || !canWrite}>
              {addRecord.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

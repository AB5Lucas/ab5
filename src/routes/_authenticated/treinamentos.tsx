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
    (trainings.data ?? []).forEach((t) => m.set(t.id, t.name));
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

  const addRecord = useMutation({
    mutationFn: async () => {
      if (!rPerson) throw new Error("Selecione o colaborador");
      if (!rTraining) throw new Error("Selecione o treinamento");
      const training = (trainings.data ?? []).find((t) => t.id === rTraining);
      const expires = training?.validity_months ? addMonths(rDate, training.validity_months) : null;
      const { error } = await supabase.from("collaborator_trainings").insert({
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

  const filtered = (records.data ?? []).filter((r) => filter === "all" || statusOf(r.expires_at) === filter);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Treinamentos"
        description="Catálogo de treinamentos e controle de validade por colaborador."
        actions={
          canWrite && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Registrar treinamento
            </Button>
          )
        }
      />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Registros</TabsTrigger>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4 pt-4">
          <div className="max-w-xs space-y-1">
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
                        <TableCell className="font-medium">{nameById.get(r.collaborator_id) ?? "—"}</TableCell>
                        <TableCell>{nameById.get(r.training_id) ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{r.completed_at}</TableCell>
                        <TableCell className="hidden md:table-cell">{r.expires_at ?? "Sem validade"}</TableCell>
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
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
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

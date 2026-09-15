import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/colaboradores/estrutura")({
  head: () => ({
    meta: [
      { title: "Funções e Departamentos | Programação Operacional" },
      { name: "description", content: "Gestão das funções e departamentos usados no cadastro de colaboradores." },
      { property: "og:title", content: "Funções e Departamentos" },
      { property: "og:description", content: "Estrutura organizacional da operação: funções e departamentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StructurePage,
});

import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { insertSequentially, normText, titleCase, titleCaseOrNull } from "@/lib/import-helpers";

const POSITION_COLUMNS: ImportColumn[] = [
  { key: "nome", required: true, example: "Eletricista" },
  { key: "descricao", example: "Responsável por instalações elétricas" },
  { key: "ativo", hint: "Sim ou Não (padrão Sim).", example: "Sim" },
];


type Row = { id: string; name: string; active: boolean; description?: string | null };

function StructurePage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Row[];
    },
  });

  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("positions").select("*").order("name");
      if (error) throw error;
      return data as Row[];
    },
  });

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });

  // --- shared mutations -----------------------------------------------------
  const toggleActive = useMutation({
    mutationFn: async ({ table, id, active }: { table: "departments" | "positions"; id: string; active: boolean }) => {
      const { error } = await supabase.from(table).update({ active }).eq("id", id);
      if (error) throw error;
      return table;
    },
    onSuccess: (table) => invalidate(table),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async ({ table, id }: { table: "departments" | "positions"; id: string }) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      return table;
    },
    onSuccess: (table) => {
      toast.success("Registro excluído.");
      invalidate(table);
    },
    onError: () => toast.error("Não foi possível excluir: existem registros vinculados."),
  });

  // --- department form ------------------------------------------------------
  const [deptName, setDeptName] = useState("");
  const createDept = useMutation({
    mutationFn: async () => {
      const name = deptName.trim();
      if (name.length < 2) throw new Error("Informe o nome do departamento");
      const { error } = await supabase.from("departments").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      setDeptName("");
      toast.success("Departamento criado.");
      invalidate("departments");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- position form --------------------------------------------------------
  const [posName, setPosName] = useState("");
  const [posDesc, setPosDesc] = useState("");
  const createPosition = useMutation({
    mutationFn: async () => {
      const name = posName.trim();
      if (name.length < 2) throw new Error("Informe o nome da função");
      const { error } = await supabase
        .from("positions")
        .insert({ name, description: posDesc.trim() === "" ? null : posDesc.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setPosName("");
      setPosDesc("");
      toast.success("Função criada.");
      invalidate("positions");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function RowsTable({
    table,
    rows,
    loading,
    extraHeader,
    extraCell,
  }: {
    table: "departments" | "positions";
    rows: Row[] | undefined;
    loading: boolean;
    extraHeader?: string;
    extraCell?: (row: Row) => React.ReactNode;
  }) {
    return (
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {extraHeader && <TableHead>{extraHeader}</TableHead>}
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            ) : (rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Nenhum registro cadastrado.</TableCell>
              </TableRow>
            ) : (
              (rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  {extraHeader && <TableCell>{extraCell?.(r)}</TableCell>}
                  <TableCell>
                    {canWrite ? (
                      <Switch
                        checked={r.active}
                        onCheckedChange={(v) => toggleActive.mutate({ table, id: r.id, active: v })}
                      />
                    ) : (
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Ativo" : "Inativo"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => removeRow.mutate({ table, id: r.id })}>
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
    );
  }

  async function importSimple(table: "positions" | "departments", rows: ImportRow[]) {
    const errors: string[] = [];
    const recs: { line: number; values: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = titleCase(r["nome"] ?? "");
      if (!name) {
        errors.push(`Linha ${line}: nome é obrigatório.`);
        return;
      }
      const values: Record<string, unknown> = {
        name,
        active: !normText(r["ativo"] ?? "").startsWith("n"),
      };
      if (table === "positions") values["description"] = titleCaseOrNull(r["descricao"] ?? "");
      recs.push({ line, values });
    });
    const result = await insertSequentially(
      recs,
      async (values) => {
        const { error } = await supabase.from(table).insert(values as never);
        return { error };
      },
      errors,
    );
    await invalidate(table);
    return result;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funções e Departamentos"
        description="Departamentos são as áreas da empresa (ex.: Serviços, Indústria) e funções são os cargos dos colaboradores."
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <ImportDialog
                entity="funções"
                columns={POSITION_COLUMNS}
                onImport={(rows) => importSimple("positions", rows)}
              />
            )}
            <Button variant="outline" asChild>
              <Link to="/colaboradores">
                <ArrowLeft className="h-4 w-4" />
                Colaboradores
              </Link>
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="positions">
        <TabsList>
          <TabsTrigger value="positions">Funções</TabsTrigger>
          <TabsTrigger value="departments">Departamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="pos-name">Nova função</Label>
                <Input id="pos-name" value={posName} onChange={(e) => setPosName(e.target.value)} placeholder="Ex.: Eletricista" />
              </div>
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="pos-desc">Descrição</Label>
                <Input id="pos-desc" value={posDesc} onChange={(e) => setPosDesc(e.target.value)} />
              </div>
              <Button onClick={() => createPosition.mutate()} disabled={createPosition.isPending}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>
          )}
          <RowsTable
            table="positions"
            rows={positions.data}
            loading={positions.isLoading}
            extraHeader="Descrição"
            extraCell={(r) => r.description || "—"}
          />
        </TabsContent>

        <TabsContent value="departments" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="dept-name">Novo departamento</Label>
                <Input id="dept-name" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Ex.: Serviços" />
              </div>
              <Button onClick={() => createDept.mutate()} disabled={createDept.isPending}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>
          )}
          <RowsTable table="departments" rows={departments.data} loading={departments.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

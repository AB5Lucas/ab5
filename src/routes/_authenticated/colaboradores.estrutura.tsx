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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/colaboradores/estrutura")({
  head: () => ({
    meta: [
      { title: "Funções | Programação Operacional" },
      { name: "description", content: "Gestão das funções usadas no cadastro de colaboradores." },
      { property: "og:title", content: "Funções" },
      { property: "og:description", content: "Estrutura organizacional da operação: funções dos colaboradores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StructurePage,
});

import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { createNameMatcher, insertSequentially, normText, titleCase, titleCaseOrNull } from "@/lib/import-helpers";

const POSITION_COLUMNS: ImportColumn[] = [
  { key: "nome", required: true, hint: "Inclua o nível quando houver (N1, N2, N3, N4) — cada nível é uma função separada.", example: "Montador de Andaimes N1" },
  { key: "descricao", example: "Responsável por instalações elétricas" },
  { key: "ativo", hint: "Sim ou Não (padrão Sim).", example: "Sim" },
];

type Row = { id: string; name: string; active: boolean; description?: string | null };

function StructurePage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();

  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("positions").select("*").order("name");
      if (error) throw error;
      return data as Row[];
    },
  });

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("positions").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate("positions"),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from("positions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro excluído.");
      invalidate("positions");
    },
    onError: () => toast.error("Não foi possível excluir: existem registros vinculados."),
  });

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

  async function importPositions(rows: ImportRow[]) {
    const errors: string[] = [];
    const recs: { line: number; values: Record<string, unknown> }[] = [];
    const existing = positions.data ?? [];
    const matchExisting = createNameMatcher(existing.map((x) => ({ id: x.id, name: x.name })));
    const seen: { id: string; name: string }[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = titleCase(r["nome"] ?? "");
      if (!name) {
        errors.push(`Linha ${line}: nome é obrigatório.`);
        return;
      }
      const already = matchExisting(name) ?? createNameMatcher(seen)(name);
      if (already) {
        errors.push(`Linha ${line}: "${name}" já existe como "${already.name}" — linha ignorada.`);
        return;
      }
      seen.push({ id: name, name });
      recs.push({
        line,
        values: {
          name,
          active: !normText(r["ativo"] ?? "").startsWith("n"),
          description: titleCaseOrNull(r["descricao"] ?? ""),
        },
      });
    });
    const result = await insertSequentially(
      recs,
      async (values) => {
        const { error } = await supabase.from("positions").insert(values as never);
        return { error };
      },
      errors,
    );
    await invalidate("positions");
    return result;
  }

  const rows = positions.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funções"
        description="Funções são os cargos dos colaboradores (ex.: Montador de Andaimes N1)."
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <ImportDialog entity="funções" columns={POSITION_COLUMNS} onImport={importPositions} />
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

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Nenhuma função cadastrada.</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.description || "—"}</TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Switch checked={r.active} onCheckedChange={(v) => toggleActive.mutate({ id: r.id, active: v })} />
                    ) : (
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Ativo" : "Inativo"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => removeRow.mutate({ id: r.id })}>
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
    </div>
  );
}

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/colaboradores/estrutura")({
  head: () => ({
    meta: [
      { title: "Cargos, Setores e Departamentos | Programação Operacional" },
      { name: "description", content: "Gestão dos cargos, setores e departamentos usados no cadastro de colaboradores." },
      { property: "og:title", content: "Cargos, Setores e Departamentos" },
      { property: "og:description", content: "Estrutura organizacional da operação: cargos, setores e departamentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StructurePage,
});

const NONE = "__none__";

type Row = { id: string; name: string; active: boolean; description?: string | null; department_id?: string | null };

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

  const sectors = useQuery({
    queryKey: ["sectors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sectors").select("*").order("name");
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
    mutationFn: async ({ table, id, active }: { table: "departments" | "sectors" | "positions"; id: string; active: boolean }) => {
      const { error } = await supabase.from(table).update({ active }).eq("id", id);
      if (error) throw error;
      return table;
    },
    onSuccess: (table) => invalidate(table),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async ({ table, id }: { table: "departments" | "sectors" | "positions"; id: string }) => {
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

  // --- sector form ----------------------------------------------------------
  const [sectorName, setSectorName] = useState("");
  const [sectorDept, setSectorDept] = useState(NONE);
  const createSector = useMutation({
    mutationFn: async () => {
      const name = sectorName.trim();
      if (name.length < 2) throw new Error("Informe o nome do setor");
      const { error } = await supabase
        .from("sectors")
        .insert({ name, department_id: sectorDept === NONE ? null : sectorDept });
      if (error) throw error;
    },
    onSuccess: () => {
      setSectorName("");
      setSectorDept(NONE);
      toast.success("Setor criado.");
      invalidate("sectors");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- position form --------------------------------------------------------
  const [posName, setPosName] = useState("");
  const [posDesc, setPosDesc] = useState("");
  const createPosition = useMutation({
    mutationFn: async () => {
      const name = posName.trim();
      if (name.length < 2) throw new Error("Informe o nome do cargo");
      const { error } = await supabase
        .from("positions")
        .insert({ name, description: posDesc.trim() === "" ? null : posDesc.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setPosName("");
      setPosDesc("");
      toast.success("Cargo criado.");
      invalidate("positions");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deptName_ = (id?: string | null) =>
    id ? departments.data?.find((d) => d.id === id)?.name ?? "—" : "—";

  function RowsTable({
    table,
    rows,
    loading,
    extraHeader,
    extraCell,
  }: {
    table: "departments" | "sectors" | "positions";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cargos e Setores"
        description="Estrutura organizacional usada no cadastro de colaboradores."
        actions={
          <Button variant="outline" asChild>
            <Link to="/colaboradores">
              <ArrowLeft className="h-4 w-4" />
              Colaboradores
            </Link>
          </Button>
        }
      />

      <Tabs defaultValue="positions">
        <TabsList>
          <TabsTrigger value="positions">Cargos</TabsTrigger>
          <TabsTrigger value="sectors">Setores</TabsTrigger>
          <TabsTrigger value="departments">Departamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="pos-name">Novo cargo</Label>
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

        <TabsContent value="sectors" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="sector-name">Novo setor</Label>
                <Input id="sector-name" value={sectorName} onChange={(e) => setSectorName(e.target.value)} placeholder="Ex.: Manutenção" />
              </div>
              <div className="min-w-[200px] space-y-2">
                <Label>Departamento</Label>
                <Select value={sectorDept} onValueChange={setSectorDept}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem departamento</SelectItem>
                    {(departments.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createSector.mutate()} disabled={createSector.isPending}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>
          )}
          <RowsTable
            table="sectors"
            rows={sectors.data}
            loading={sectors.isLoading}
            extraHeader="Departamento"
            extraCell={(r) => deptName_(r.department_id)}
          />
        </TabsContent>

        <TabsContent value="departments" className="space-y-4 pt-4">
          {canWrite && (
            <div className="panel flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Label htmlFor="dept-name">Novo departamento</Label>
                <Input id="dept-name" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Ex.: Operações" />
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

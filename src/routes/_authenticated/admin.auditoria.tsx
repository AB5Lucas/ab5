import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria | Programação Operacional" },
      { name: "description", content: "Histórico de alterações feitas no sistema, com autor, data e dados alterados." },
      { property: "og:title", content: "Auditoria | Programação Operacional" },
      { property: "og:description", content: "Histórico de alterações feitas no sistema, com autor, data e dados alterados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const ACTION_LABEL: Record<string, string> = {
  INSERT: "Criação",
  UPDATE: "Alteração",
  DELETE: "Exclusão",
};

const ENTITY_LABEL: Record<string, string> = {
  collaborators: "Colaboradores",
  works: "Obras",
  daily_schedules: "Programação diária",
  daily_allocations: "Alocações",
  vehicles: "Veículos",
  vacations: "Férias",
  medical_leaves: "Atestados",
  days_off: "Folgas",
  trainings: "Treinamentos",
  users_profiles: "Usuários",
  user_roles: "Perfis de acesso",
};

function label(entity: string) {
  return ENTITY_LABEL[entity] ?? entity;
}

function Page() {
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");

  const logs = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const [{ data, error }, { data: profiles }] = await Promise.all([
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(300),
        supabase.from("users_profiles").select("id, full_name, email"),
      ]);
      if (error) throw error;
      const byId = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
      return (data ?? []).map((l) => ({ ...l, author: (l.user_id && byId.get(l.user_id)) || "Sistema" }));
    },
  });

  const entities = useMemo(
    () => [...new Set((logs.data ?? []).map((l) => l.entity_type))].sort(),
    [logs.data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (logs.data ?? []).filter((l) => {
      if (entity !== "all" && l.entity_type !== entity) return false;
      if (action !== "all" && l.action !== action) return false;
      if (term && !`${l.author} ${label(l.entity_type)} ${l.entity_id ?? ""}`.toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [logs.data, entity, action, search]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Auditoria"
        description="Últimos 300 registros de alterações feitas no sistema."
      />

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label>Módulo</Label>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os módulos</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {label(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="INSERT">Criação</SelectItem>
              <SelectItem value="UPDATE">Alteração</SelectItem>
              <SelectItem value="DELETE">Exclusão</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="busca">Buscar</Label>
          <Input
            id="busca"
            placeholder="Autor ou módulo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Autor</TableHead>
              <TableHead>Módulo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!logs.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Nenhum registro de auditoria encontrado.
                </TableCell>
              </TableRow>
            )}
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="font-medium">{l.author}</TableCell>
                <TableCell>{label(l.entity_type)}</TableCell>
                <TableCell>
                  <Badge variant={l.action === "DELETE" ? "destructive" : "secondary"}>
                    {ACTION_LABEL[l.action] ?? l.action}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Collapsible>
                    <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4">
                      Ver dados
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-2 max-w-md overflow-x-auto rounded-md bg-secondary p-2 text-xs">
                        {JSON.stringify({ antes: l.old_data, depois: l.new_data }, null, 2)}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

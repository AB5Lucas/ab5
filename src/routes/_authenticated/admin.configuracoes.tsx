import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Programação Operacional" },
      { name: "description", content: "Feriados do calendário operacional e informações gerais do sistema." },
      { property: "og:title", content: "Configurações | Programação Operacional" },
      { property: "og:description", content: "Feriados do calendário operacional e informações gerais do sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function fmtDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

function Page() {
  const { canWrite } = useCurrentUser();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  const holidays = useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("*").order("date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addHoliday = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("holidays").insert({ name: name.trim(), date });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Feriado cadastrado");
      setName("");
      setDate("");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error("Não foi possível cadastrar: " + e.message),
  });

  const removeHoliday = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("holidays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Feriado removido");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error("Não foi possível remover: " + e.message),
  });

  const counts = useQuery({
    queryKey: ["system-counts"],
    queryFn: async () => {
      const tables = ["collaborators", "works", "vehicles", "trainings"] as const;
      const results = await Promise.all(
        tables.map((t) => supabase.from(t).select("id", { count: "exact", head: true })),
      );
      return {
        collaborators: results[0]?.count ?? 0,
        works: results[1]?.count ?? 0,
        vehicles: results[2]?.count ?? 0,
        trainings: results[3]?.count ?? 0,
      };
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Configurações"
        description="Calendário de feriados e visão geral dos cadastros do sistema."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Colaboradores" value={counts.data?.collaborators ?? 0} />
        <Stat label="Obras" value={counts.data?.works ?? 0} />
        <Stat label="Veículos" value={counts.data?.vehicles ?? 0} />
        <Stat label="Treinamentos" value={counts.data?.trainings ?? 0} />
      </div>

      <div className="panel space-y-4 p-4">
        <div>
          <h2 className="font-display text-lg uppercase tracking-wide">Feriados</h2>
          <p className="text-sm text-muted-foreground">
            Datas marcadas como feriado aparecem destacadas na programação.
          </p>
        </div>

        {canWrite ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !date) {
                toast.error("Informe o nome e a data do feriado.");
                return;
              }
              addHoliday.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="holiday-name">Nome</Label>
              <Input
                id="holiday-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Independência"
                className="w-64"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="holiday-date">Data</Label>
              <Input
                id="holiday-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
              />
            </div>
            <Button type="submit" disabled={addHoliday.isPending}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </form>
        ) : (
          <p className="rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
            Seu perfil permite apenas consulta.
          </p>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!holidays.isLoading && (holidays.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Nenhum feriado cadastrado.
                  </TableCell>
                </TableRow>
              )}
              {(holidays.data ?? []).map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(h.date)}</TableCell>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeHoliday.mutate(h.id)}
                        aria-label={`Remover ${h.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

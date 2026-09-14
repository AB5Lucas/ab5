import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/obras/equipes-base")({
  head: () => ({
    meta: [
      { title: "Equipes Base | Programação Operacional" },
      { name: "description", content: "Equipe padrão de cada obra, usada como ponto de partida da programação diária." },
      { property: "og:title", content: "Equipes Base | Programação Operacional" },
      { property: "og:description", content: "Equipe padrão de cada obra, independente da programação diária." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BaseTeamsPage,
});

const NONE = "__none__";
const today = () => new Date().toISOString().slice(0, 10);

type FormState = {
  collaborator_id: string;
  position_id: string;
  start_date: string;
  end_date: string;
  notes: string;
};

const emptyForm: FormState = {
  collaborator_id: "",
  position_id: NONE,
  start_date: today(),
  end_date: "",
  notes: "",
};

function BaseTeamsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [workId, setWorkId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const works = useQuery({
    queryKey: ["works-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("works")
        .select("id, code, name")
        .eq("active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const people = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, position_id")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("positions").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const team = useQuery({
    queryKey: ["work-base-team", workId],
    enabled: !!workId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_base_teams")
        .select("*")
        .eq("work_id", workId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (people.data ?? []).forEach((p) => map.set(p.id, p.full_name));
    (positions.data ?? []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [people.data, positions.data]);

  const add = useMutation({
    mutationFn: async () => {
      if (!workId) throw new Error("Selecione uma obra");
      if (!form.collaborator_id) throw new Error("Selecione um colaborador");
      const already = (team.data ?? []).some((t) => t.collaborator_id === form.collaborator_id && t.active);
      if (already) throw new Error("Colaborador já está na equipe base desta obra");

      const { error } = await supabase.from("work_base_teams").insert({
        work_id: workId,
        collaborator_id: form.collaborator_id,
        position_id: form.position_id === NONE ? null : form.position_id,
        start_date: form.start_date || today(),
        end_date: form.end_date || null,
        notes: form.notes.trim() || null,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador adicionado à equipe base");
      setOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["work-base-team", workId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("work_base_teams")
        .update({ active, end_date: active ? null : today() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-base-team", workId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_base_teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro removido");
      queryClient.invalidateQueries({ queryKey: ["work-base-team", workId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Equipes Base"
        description="Equipe padrão de cada obra, independente da programação diária."
      
        actions={
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/obras">
            <ArrowLeft className="h-4 w-4" /> Obras
          </Link>
        </Button>
        {canWrite && (
          <Button
            size="sm"
            disabled={!workId}
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Adicionar colaborador
          </Button>
        )}
      </div>
        }
      />

      <div className="max-w-sm space-y-1">
        <Label>Obra</Label>
        <Select value={workId} onValueChange={setWorkId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma obra" />
          </SelectTrigger>
          <SelectContent>
            {(works.data ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!workId ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Selecione uma obra para ver e montar a equipe base.
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead className="hidden md:table-cell">Função na obra</TableHead>
                <TableHead className="hidden lg:table-cell">Início</TableHead>
                <TableHead className="hidden lg:table-cell">Fim</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!team.isLoading && (team.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Nenhum colaborador na equipe base desta obra.
                  </TableCell>
                </TableRow>
              )}
              {(team.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{nameById.get(t.collaborator_id) ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.position_id ? (nameById.get(t.position_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{t.start_date}</TableCell>
                  <TableCell className="hidden lg:table-cell">{t.end_date ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Ativo" : "Encerrado"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}
                        >
                          {t.active ? "Encerrar" : "Reativar"}
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover da equipe base"
                          onClick={() => remove.mutate(t.id)}
                        >
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
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar à equipe base</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Colaborador *</Label>
              <Select value={form.collaborator_id} onValueChange={(v) => set("collaborator_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Função na obra</Label>
              <Select value={form.position_id} onValueChange={(v) => set("position_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Usar cargo do colaborador</SelectItem>
                  {(positions.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Início</Label>
                <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Fim (opcional)</Label>
                <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !canWrite}>
              {add.isPending ? "Salvando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

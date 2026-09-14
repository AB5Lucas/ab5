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
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Enums } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/obras/requisitos")({
  head: () => ({
    meta: [
      { title: "Requisitos das Obras | Programação Operacional" },
      { name: "description", content: "Treinamentos, certificações, cargos e CNH exigidos por obra na alocação diária." },
      { property: "og:title", content: "Requisitos das Obras | Programação Operacional" },
      { property: "og:description", content: "Treinamentos, certificações e CNH exigidos por obra." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequirementsPage,
});

type ReqType = Enums<"requirement_type">;

const TYPE_LABEL: Record<ReqType, string> = {
  training: "Treinamento",
  certification: "Certificação",
  position: "Cargo",
  driver_license: "CNH",
  medical_exam: "Exame médico",
  custom: "Personalizado",
};

type FormState = {
  requirement_type: ReqType;
  requirement_id: string;
  requirement_label: string;
  mandatory: boolean;
  blocking: boolean;
};

const emptyForm: FormState = {
  requirement_type: "training",
  requirement_id: "",
  requirement_label: "",
  mandatory: true,
  blocking: false,
};

function RequirementsPage() {
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

  const trainings = useQuery({
    queryKey: ["trainings-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trainings").select("id, name").eq("active", true).order("name");
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

  const requirements = useQuery({
    queryKey: ["work-requirements", workId],
    enabled: !!workId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_requirements")
        .select("*")
        .eq("work_id", workId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (trainings.data ?? []).forEach((t) => map.set(t.id, t.name));
    (positions.data ?? []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [trainings.data, positions.data]);

  const needsReference = form.requirement_type === "training" || form.requirement_type === "position";
  const referenceOptions = form.requirement_type === "training" ? (trainings.data ?? []) : (positions.data ?? []);

  const add = useMutation({
    mutationFn: async () => {
      if (!workId) throw new Error("Selecione uma obra");
      if (needsReference && !form.requirement_id) throw new Error("Selecione o item exigido");
      if (!needsReference && !form.requirement_label.trim()) throw new Error("Descreva o requisito");

      const { error } = await supabase.from("work_requirements").insert({
        work_id: workId,
        requirement_type: form.requirement_type,
        requirement_id: needsReference ? form.requirement_id : null,
        requirement_label: needsReference
          ? (nameById.get(form.requirement_id) ?? null)
          : form.requirement_label.trim(),
        mandatory: form.mandatory,
        blocking: form.blocking,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Requisito adicionado");
      setOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["work-requirements", workId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { mandatory?: boolean; blocking?: boolean; active?: boolean } }) => {
      const { error } = await supabase.from("work_requirements").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-requirements", workId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_requirements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Requisito removido");
      queryClient.invalidateQueries({ queryKey: ["work-requirements", workId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Requisitos das Obras"
        description="Treinamentos, certificações e CNH exigidos por obra."
      
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
            <Plus className="h-4 w-4" /> Novo requisito
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
          Selecione uma obra para configurar os requisitos exigidos.
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Requisito</TableHead>
                <TableHead>Obrigatório</TableHead>
                <TableHead>Bloqueia alocação</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!requirements.isLoading && (requirements.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Nenhum requisito configurado para esta obra.
                  </TableCell>
                </TableRow>
              )}
              {(requirements.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABEL[r.requirement_type]}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.requirement_label ?? (r.requirement_id ? (nameById.get(r.requirement_id) ?? "—") : "—")}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.mandatory}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update.mutate({ id: r.id, patch: { mandatory: v } })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.blocking}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update.mutate({ id: r.id, patch: { blocking: v } })}
                    />
                  </TableCell>
                  <TableCell>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover requisito"
                        onClick={() => remove.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
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
            <DialogTitle>Novo requisito</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.requirement_type}
                onValueChange={(v) => setForm({ ...emptyForm, requirement_type: v as ReqType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as ReqType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsReference ? (
              <div className="space-y-1">
                <Label>{form.requirement_type === "training" ? "Treinamento" : "Cargo"} *</Label>
                <Select value={form.requirement_id} onValueChange={(v) => set("requirement_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {referenceOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Descrição do requisito *</Label>
                <Input
                  value={form.requirement_label}
                  placeholder="Ex.: CNH categoria D válida"
                  onChange={(e) => set("requirement_label", e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch id="req-mandatory" checked={form.mandatory} onCheckedChange={(v) => set("mandatory", v)} />
              <Label htmlFor="req-mandatory">Obrigatório</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="req-blocking" checked={form.blocking} onCheckedChange={(v) => set("blocking", v)} />
              <Label htmlFor="req-blocking">Bloqueia a alocação quando não atendido</Label>
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

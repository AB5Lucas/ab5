import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/veiculos/")({
  head: () => ({
    meta: [
      { title: "Frota | Programação Operacional" },
      { name: "description", content: "Cadastro da frota: placa, modelo, capacidade de passageiros e situação operacional." },
      { property: "og:title", content: "Frota | Programação Operacional" },
      { property: "og:description", content: "Cadastro e situação dos veículos da operação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VehiclesPage,
});

type Vehicle = Tables<"vehicles">;
type VehicleStatus = Vehicle["status"];

const STATUS_LABEL: Record<VehicleStatus, string> = {
  available: "Disponível",
  in_use: "Em uso",
  maintenance: "Manutenção",
  inactive: "Inativo",
};

const schema = z.object({
  plate: z.string().trim().min(5, "Informe a placa").max(10),
  passenger_capacity: z.number().int().min(0).max(100),
});

type FormState = {
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  type: string;
  passenger_capacity: string;
  fuel_type: string;
  status: VehicleStatus;
  notes: string;
};

const emptyForm: FormState = {
  plate: "",
  brand: "",
  model: "",
  year: "",
  color: "",
  type: "",
  passenger_capacity: "0",
  fuel_type: "",
  status: "available",
  notes: "",
};

const nn = (v: string) => (v.trim() === "" ? null : v.trim());

function VehiclesPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | VehicleStatus>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const vehicles = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("plate");
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (vehicles.data ?? []).filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!q) return true;
      return [v.plate, v.brand, v.model, v.type].filter(Boolean).some((x) => String(x).toLowerCase().includes(q));
    });
  }, [vehicles.data, search, statusFilter]);

  const save = useMutation({
    mutationFn: async () => {
      const capacity = Number(form.passenger_capacity || 0);
      const parsed = schema.safeParse({ plate: form.plate, passenger_capacity: capacity });
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        plate: form.plate.trim().toUpperCase(),
        brand: nn(form.brand),
        model: nn(form.model),
        year: form.year.trim() === "" ? null : Number(form.year),
        color: nn(form.color),
        type: nn(form.type),
        passenger_capacity: capacity,
        fuel_type: nn(form.fuel_type),
        status: form.status,
        notes: nn(form.notes),
      };
      const { error } = editing
        ? await supabase.from("vehicles").update(payload).eq("id", editing.id)
        : await supabase.from("vehicles").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Veículo atualizado." : "Veículo cadastrado.");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Veículo excluído.");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(v: Vehicle) {
    setEditing(v);
    setForm({
      plate: v.plate ?? "",
      brand: v.brand ?? "",
      model: v.model ?? "",
      year: v.year ? String(v.year) : "",
      color: v.color ?? "",
      type: v.type ?? "",
      passenger_capacity: String(v.passenger_capacity ?? 0),
      fuel_type: v.fuel_type ?? "",
      status: v.status,
      notes: v.notes ?? "",
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Frota"
        description="Cadastro dos veículos, capacidade de passageiros e situação operacional."
        actions={
          canWrite && (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Novo veículo
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por placa, marca, modelo ou tipo"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            <SelectItem value="available">Disponível</SelectItem>
            <SelectItem value="in_use">Em uso</SelectItem>
            <SelectItem value="maintenance">Manutenção</SelectItem>
            <SelectItem value="inactive">Inativo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placa</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Capacidade</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">Carregando frota...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">Nenhum veículo encontrado.</TableCell>
              </TableRow>
            ) : (
              filtered.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs uppercase">{v.plate}</TableCell>
                  <TableCell>
                    <div className="font-medium">{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[v.year, v.color, v.fuel_type].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>{v.type || "—"}</TableCell>
                  <TableCell>{v.passenger_capacity} passageiros</TableCell>
                  <TableCell>
                    <Badge variant={v.status === "available" ? "default" : v.status === "in_use" ? "outline" : "secondary"}>
                      {STATUS_LABEL[v.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(v)}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar veículo" : "Novo veículo"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plate">Placa *</Label>
              <Input id="plate" value={form.plate} onChange={(e) => set("plate", e.target.value)} placeholder="ABC1D23" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Tipo</Label>
              <Input id="type" value={form.type} onChange={(e) => set("type", e.target.value)} placeholder="Van, ônibus, pick-up" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand">Marca</Label>
              <Input id="brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Input id="model" value={form.model} onChange={(e) => set("model", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Ano</Label>
              <Input id="year" type="number" value={form.year} onChange={(e) => set("year", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <Input id="color" value={form.color} onChange={(e) => set("color", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacidade de passageiros</Label>
              <Input id="capacity" type="number" min={0} value={form.passenger_capacity} onChange={(e) => set("passenger_capacity", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuel">Combustível</Label>
              <Input id="fuel" value={form.fuel_type} onChange={(e) => set("fuel_type", e.target.value)} placeholder="Diesel, flex" />
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as VehicleStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Disponível</SelectItem>
                  <SelectItem value="in_use">Em uso</SelectItem>
                  <SelectItem value="maintenance">Manutenção</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes-v">Observações</Label>
              <Textarea id="notes-v" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !canWrite}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir veículo</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.plate} será removido permanentemente. Se houver programações vinculadas, marque o veículo como inativo.
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

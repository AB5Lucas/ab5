import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bus, Pencil, Plus, Trash2 } from "lucide-react";
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
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/veiculos/transporte")({
  head: () => ({
    meta: [
      { title: "Transporte | Programação Operacional" },
      { name: "description", content: "Planejamento de transporte por obra: veículo, motorista, passageiros e horários de saída e retorno." },
      { property: "og:title", content: "Transporte | Programação Operacional" },
      { property: "og:description", content: "Veículo, motorista, passageiros e horários por obra." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TransportPage,
});

const NONE = "__none__";

type FormState = {
  work_id: string;
  vehicle_id: string;
  driver_id: string;
  departure_time: string;
  return_time: string;
  passenger_count: string;
  notes: string;
};

const emptyForm: FormState = {
  work_id: "",
  vehicle_id: NONE,
  driver_id: NONE,
  departure_time: "",
  return_time: "",
  passenger_count: "0",
  notes: "",
};

const nn = (v: string) => (v.trim() === "" ? null : v.trim());
const ref = (v: string) => (v === NONE ? null : v);

function TransportPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const base = useQuery({
    queryKey: ["transport-base"],
    queryFn: async () => {
      const [works, vehicles, drivers] = await Promise.all([
        supabase.from("works").select("id, name, code, entry_time, exit_time, status").eq("active", true).order("name"),
        supabase.from("vehicles").select("id, plate, model, passenger_capacity, status").order("plate"),
        supabase
          .from("collaborators")
          .select("id, full_name, driver_license_category")
          .eq("is_driver", true)
          .eq("status", "active")
          .order("full_name"),
      ]);
      return { works: works.data ?? [], vehicles: vehicles.data ?? [], drivers: drivers.data ?? [] };
    },
  });

  const day = useQuery({
    queryKey: ["transport-day", date],
    queryFn: async () => {
      const { data: sched } = await supabase
        .from("daily_schedules")
        .select("id, status")
        .eq("schedule_date", date)
        .maybeSingle();
      if (!sched) return { schedule: null, transports: [], allocationsByWork: {} as Record<string, number> };
      const [{ data: transports }, { data: allocations }] = await Promise.all([
        supabase.from("transport_allocations").select("*").eq("schedule_id", sched.id),
        supabase.from("daily_allocations").select("work_id").eq("schedule_id", sched.id),
      ]);
      const allocationsByWork: Record<string, number> = {};
      (allocations ?? []).forEach((a) => {
        allocationsByWork[a.work_id] = (allocationsByWork[a.work_id] ?? 0) + 1;
      });
      return { schedule: sched, transports: transports ?? [], allocationsByWork };
    },
  });

  const locked = day.data?.schedule?.status === "finalized" && !isAdmin;
  const canEdit = canWrite && !!day.data?.schedule && !locked;

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    base.data?.works.forEach((w) => map.set(w.id, `${w.code} · ${w.name}`));
    base.data?.vehicles.forEach((v) => map.set(v.id, `${v.plate}${v.model ? ` · ${v.model}` : ""}`));
    base.data?.drivers.forEach((d) => map.set(d.id, d.full_name));
    return map;
  }, [base.data]);

  const capacityOf = useMemo(() => {
    const map = new Map<string, number>();
    base.data?.vehicles.forEach((v) => map.set(v.id, v.passenger_capacity ?? 0));
    return map;
  }, [base.data]);

  const save = useMutation({
    mutationFn: async () => {
      const scheduleId = day.data?.schedule?.id;
      if (!scheduleId) throw new Error("Crie a programação do dia antes de planejar o transporte.");
      if (!form.work_id) throw new Error("Selecione a obra.");
      const passengers = Number(form.passenger_count || 0);
      const capacity = form.vehicle_id === NONE ? null : capacityOf.get(form.vehicle_id) ?? 0;
      if (capacity !== null && capacity > 0 && passengers > capacity) {
        throw new Error(`Capacidade excedida: o veículo comporta ${capacity} passageiros.`);
      }
      const payload = {
        schedule_id: scheduleId,
        work_id: form.work_id,
        vehicle_id: ref(form.vehicle_id),
        driver_id: ref(form.driver_id),
        departure_time: nn(form.departure_time),
        return_time: nn(form.return_time),
        passenger_count: passengers,
        notes: nn(form.notes),
      };
      const { error } = editingId
        ? await supabase.from("transport_allocations").update(payload).eq("id", editingId)
        : await supabase.from("transport_allocations").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Transporte atualizado." : "Transporte planejado.");
      queryClient.invalidateQueries({ queryKey: ["transport-day", date] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transport_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transporte removido.");
      queryClient.invalidateQueries({ queryKey: ["transport-day", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    const firstWork = base.data?.works[0];
    setEditingId(null);
    setForm({
      ...emptyForm,
      work_id: firstWork?.id ?? "",
      departure_time: firstWork?.entry_time?.slice(0, 5) ?? "",
      return_time: firstWork?.exit_time?.slice(0, 5) ?? "",
      passenger_count: String(firstWork ? day.data?.allocationsByWork[firstWork.id] ?? 0 : 0),
    });
    setOpen(true);
  }

  function openEdit(t: Tables<"transport_allocations">) {
    setEditingId(t.id);
    setForm({
      work_id: t.work_id,
      vehicle_id: t.vehicle_id ?? NONE,
      driver_id: t.driver_id ?? NONE,
      departure_time: (t.departure_time ?? "").slice(0, 5),
      return_time: (t.return_time ?? "").slice(0, 5),
      passenger_count: String(t.passenger_count ?? 0),
      notes: t.notes ?? "",
    });
    setOpen(true);
  }

  function onWorkChange(workId: string) {
    const w = base.data?.works.find((x) => x.id === workId);
    setForm((f) => ({
      ...f,
      work_id: workId,
      departure_time: f.departure_time || w?.entry_time?.slice(0, 5) || "",
      return_time: f.return_time || w?.exit_time?.slice(0, 5) || "",
      passenger_count: String(day.data?.allocationsByWork[workId] ?? f.passenger_count),
    }));
  }

  const transports = day.data?.transports ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transporte"
        description="Veículo, motorista, passageiros e horários de saída e retorno por obra."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button onClick={openNew} disabled={!canEdit}>
              <Plus className="h-4 w-4" />
              Novo transporte
            </Button>
          </div>
        }
      />

      {!day.isLoading && !day.data?.schedule && (
        <div className="panel flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Bus className="h-4 w-4" />
          Não existe programação para esta data. Crie a programação diária para planejar o transporte.
        </div>
      )}

      {day.data?.schedule?.status === "finalized" && (
        <Badge variant="secondary">Programação finalizada{isAdmin ? " — edição liberada para administrador" : " — somente leitura"}</Badge>
      )}

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Obra</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Saída</TableHead>
              <TableHead>Retorno</TableHead>
              <TableHead>Passageiros</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {day.isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Carregando transporte...</TableCell></TableRow>
            ) : transports.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhum transporte planejado para esta data.</TableCell></TableRow>
            ) : (
              transports.map((t) => {
                const capacity = t.vehicle_id ? capacityOf.get(t.vehicle_id) ?? 0 : 0;
                const over = capacity > 0 && t.passenger_count > capacity;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{nameOf.get(t.work_id) ?? "—"}</TableCell>
                    <TableCell>{t.vehicle_id ? nameOf.get(t.vehicle_id) ?? "—" : "Sem veículo"}</TableCell>
                    <TableCell>{t.driver_id ? nameOf.get(t.driver_id) ?? "—" : "Sem motorista"}</TableCell>
                    <TableCell>{t.departure_time?.slice(0, 5) ?? "—"}</TableCell>
                    <TableCell>{t.return_time?.slice(0, 5) ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={over ? "destructive" : "outline"}>
                        {t.passenger_count}
                        {capacity > 0 ? ` / ${capacity}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)} disabled={!canEdit}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(t.id)} disabled={!canEdit}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar transporte" : "Novo transporte"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Obra</Label>
              <Select value={form.work_id} onValueChange={onWorkChange}>
                <SelectTrigger><SelectValue placeholder="Selecione a obra" /></SelectTrigger>
                <SelectContent>
                  {base.data?.works.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.work_id && (
                <p className="text-xs text-muted-foreground">
                  {day.data?.allocationsByWork[form.work_id] ?? 0} colaboradores programados nesta obra.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Veículo</Label>
              <Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem veículo</SelectItem>
                  {base.data?.vehicles
                    .filter((v) => v.status !== "inactive")
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.plate} · {v.passenger_capacity} lug.
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motorista</Label>
              <Select value={form.driver_id} onValueChange={(v) => set("driver_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem motorista</SelectItem>
                  {base.data?.drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}{d.driver_license_category ? ` · ${d.driver_license_category}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep">Horário de saída</Label>
              <Input id="dep" type="time" value={form.departure_time} onChange={(e) => set("departure_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ret">Horário de retorno</Label>
              <Input id="ret" type="time" value={form.return_time} onChange={(e) => set("return_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pax">Passageiros</Label>
              <Input id="pax" type="number" min={0} value={form.passenger_count} onChange={(e) => set("passenger_count", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes-t">Observações</Label>
              <Textarea id="notes-t" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !canEdit}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

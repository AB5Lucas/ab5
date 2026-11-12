import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { titleCase } from "@/lib/fleet-notes";

const today = () => new Date().toISOString().slice(0, 10);
const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

/** Colaboradores com CNH cadastrada (categoria ou validade), vencida ou não, ativos ou não. */
export function useCnhPeople() {
  return useQuery({
    queryKey: ["fleet-cnh-people"], staleTime: 5 * 60_000,
    queryFn: async () => ((await supabase.from("collaborators").select("id, full_name, status, driver_license_category, driver_license_expiry").order("full_name")).data ?? [])
      .filter((c) => c.driver_license_expiry || (c.driver_license_category ?? "").trim()),
  });
}

export type ReleaseEntry = { id: string; released_at: string | null; removed_at: string | null; active: boolean };
/** Liberado no dia: marcado como ativo e o dia está entre a data de liberação e a de exclusão (as duas valem). */
export const releasedOn = (e: ReleaseEntry, day: string | null) =>
  e.active && (!day || ((!e.released_at || e.released_at <= day) && (!e.removed_at || day <= e.removed_at)));

/** Motoristas e placas liberados no posto: o nome e a placa escritos na nota casam primeiro com esta lista. */
export function useFleetRelease() {
  const drivers = useQuery({ queryKey: ["fleet-release-drivers"], queryFn: async () => (await supabase.from("fleet_release_drivers").select("collaborator_id, released_at, removed_at, active")).data ?? [] });
  const vehicles = useQuery({ queryKey: ["fleet-release-vehicles"], queryFn: async () => (await supabase.from("fleet_release_vehicles").select("vehicle_id, released_at, removed_at, active")).data ?? [] });
  const driverList = useMemo<ReleaseEntry[]>(() => (drivers.data ?? []).map((d) => ({ id: d.collaborator_id, released_at: d.released_at, removed_at: d.removed_at, active: d.active })), [drivers.data]);
  const vehicleList = useMemo<ReleaseEntry[]>(() => (vehicles.data ?? []).map((v) => ({ id: v.vehicle_id, released_at: v.released_at, removed_at: v.removed_at, active: v.active })), [vehicles.data]);
  return {
    drivers: driverList, vehicles: vehicleList,
    /** Ids liberados no dia do abastecimento (ativo e dentro das datas). */
    driverIdsOn: (day: string | null) => new Set(driverList.filter((e) => releasedOn(e, day)).map((e) => e.id)),
    vehicleIdsOn: (day: string | null) => new Set(vehicleList.filter((e) => releasedOn(e, day)).map((e) => e.id)),
    isLoading: drivers.isLoading || vehicles.isLoading,
  };
}

function AddPicker({ label, placeholder, options, onPick, disabled }: {
  label: string; placeholder: string; options: { id: string; text: string; hint?: string }[]; onPick: (id: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={disabled}><Plus className="h-4 w-4" /> {label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.id} value={`${o.text} ${o.hint ?? ""}`} onSelect={() => { onPick(o.id); setOpen(false); }}>
                  <span className="flex-1 truncate">{o.text}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type Kind = "driver" | "vehicle";
const TABLE = { driver: "fleet_release_drivers", vehicle: "fleet_release_vehicles" } as const;
const KEY = { driver: "collaborator_id", vehicle: "vehicle_id" } as const;

function useReleaseWrite(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: { kind: Kind; id: string; action: "add" | "delete" | "update"; patch?: Partial<Omit<ReleaseEntry, "id">> }) => {
      const t = supabase.from(TABLE[op.kind]);
      const res = op.action === "add" ? await t.insert({ [KEY[op.kind]]: op.id, released_at: today(), active: true } as never)
        : op.action === "delete" ? await t.delete().eq(KEY[op.kind], op.id)
        : await t.update(op.patch as never).eq(KEY[op.kind], op.id);
      if (res.error) throw res.error;
    },
    onSuccess: (_, op) => {
      qc.invalidateQueries({ queryKey: [op.kind === "driver" ? "fleet-release-drivers" : "fleet-release-vehicles"] });
      toast.success(op.action === "add" ? "Liberado no posto." : op.action === "delete" ? "Retirado da lista." : "Liberação atualizada.");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Editar uma liberação: data de liberação, data de exclusão e situação. */
function EditRelease({ target, onClose }: { target: { kind: Kind; entry: ReleaseEntry; name: string } | null; onClose: () => void }) {
  const [form, setForm] = useState({ released_at: "", removed_at: "", active: true });
  useEffect(() => {
    if (target) setForm({ released_at: target.entry.released_at ?? "", removed_at: target.entry.removed_at ?? "", active: target.entry.active });
  }, [target?.kind, target?.entry.id]);
  const m = useReleaseWrite(onClose);
  if (!target) return null;
  const error = form.released_at && form.removed_at && form.removed_at < form.released_at ? "A data de exclusão não pode ser antes da data de liberação." : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar liberação</DialogTitle>
          <DialogDescription>{target.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rel-from">Data de liberação</Label>
            <Input id="rel-from" type="date" value={form.released_at} onChange={(e) => setForm({ ...form, released_at: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rel-to">Data de exclusão</Label>
            <Input id="rel-to" type="date" value={form.removed_at}
              // Ao informar a exclusão, a situação passa para inativo (pode voltar a ativo à mão).
              onChange={(e) => setForm({ ...form, removed_at: e.target.value, active: e.target.value && !form.removed_at ? false : form.active })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Situação</Label>
            <Select value={form.active ? "ativo" : "inativo"} onValueChange={(v) => setForm({ ...form, active: v === "ativo" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Vale para as notas com data entre a liberação e a exclusão, enquanto estiver ativo. Inativo não entra na conferência das notas.</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending || !!error} onClick={() => m.mutate({ kind: target.kind, id: target.entry.id, action: "update", patch: { released_at: form.released_at || null, removed_at: form.removed_at || null, active: form.active } })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ entry }: { entry: ReleaseEntry }) {
  const on = releasedOn(entry, today());
  return entry.active && !on
    ? <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">{entry.removed_at && entry.removed_at < today() ? "Ativo (excluído)" : "Ativo (a partir da data)"}</Badge>
    : entry.active ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativo</Badge> : <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>;
}

/** Frota › Abastecimento › Liberação. */
export function FleetRelease() {
  const people = useCnhPeople();
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-release"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model, status").order("plate")).data ?? [] });
  const release = useFleetRelease();
  const m = useReleaseWrite();
  const [edit, setEdit] = useState<{ kind: Kind; entry: ReleaseEntry; name: string } | null>(null);

  const personById = new Map((people.data ?? []).map((p) => [p.id, p]));
  const vehicleById = new Map((vehicles.data ?? []).map((v) => [v.id, v]));
  const listedDrivers = release.drivers.filter((e) => personById.has(e.id))
    .sort((a, b) => Number(b.active) - Number(a.active) || personById.get(a.id)!.full_name.localeCompare(personById.get(b.id)!.full_name, "pt-BR"));
  const listedVehicles = release.vehicles.filter((e) => vehicleById.has(e.id))
    .sort((a, b) => Number(b.active) - Number(a.active) || vehicleById.get(a.id)!.plate.localeCompare(vehicleById.get(b.id)!.plate));
  const takenDrivers = new Set(release.drivers.map((e) => e.id));
  const takenVehicles = new Set(release.vehicles.map((e) => e.id));
  const expired = (d: string | null) => !!d && d < today();
  const loading = release.isLoading;

  const actions = (kind: Kind, entry: ReleaseEntry, name: string) => (
    <div className="flex justify-end">
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${name}`} onClick={() => setEdit({ kind, entry, name })}><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Apagar ${name}`} title="Apagar da lista (para guardar o histórico, prefira a data de exclusão)" disabled={m.isPending}
        onClick={() => { if (window.confirm(`Apagar ${name} da lista de liberação?`)) m.mutate({ kind, id: entry.id, action: "delete" }); }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Motoristas e placas liberados para abastecer no posto. O nome escrito na nota vira o nome desta lista (se não achar aqui, de quem tem CNH cadastrada) e a placa vira a cadastrada mais próxima (ex.: ECM8414 = ECM8E14). Cada nota usa quem estava ativo e liberado na data do abastecimento.
      </p>
      <section className="panel space-y-3 p-3">
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <Label className="block">Motoristas liberados</Label>
            <p className="text-xs text-muted-foreground">{listedDrivers.filter((e) => e.active).length} ativo(s) · {people.data?.length ?? 0} com CNH cadastrada</p>
          </div>
          <AddPicker label="Motorista" placeholder="Nome do colaborador" disabled={m.isPending}
            options={(people.data ?? []).filter((p) => !takenDrivers.has(p.id)).map((p) => ({
              id: p.id, text: titleCase(p.full_name), hint: [p.status === "inactive" ? "inativo" : null, expired(p.driver_license_expiry) ? "CNH vencida" : null].filter(Boolean).join(" · ") || undefined,
            }))}
            onPick={(id) => m.mutate({ kind: "driver", id, action: "add" })} />
        </div>
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>CNH</TableHead><TableHead>Data de liberação</TableHead><TableHead>Data de exclusão</TableHead><TableHead>Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {listedDrivers.length ? listedDrivers.map((e) => {
                const p = personById.get(e.id)!;
                const name = titleCase(p.full_name);
                return (
                  <TableRow key={e.id} className={e.active ? undefined : "text-muted-foreground"}>
                    <TableCell>{name}{p.status === "inactive" && <Badge variant="outline" className="ml-2">colaborador inativo</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {p.driver_license_category ?? "—"}{p.driver_license_expiry ? ` · ${brDate(p.driver_license_expiry)}` : ""}
                      {expired(p.driver_license_expiry) && <span className="ml-1 text-destructive">vencida</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.released_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.removed_at)}</TableCell>
                    <TableCell><StatusBadge entry={e} /></TableCell>
                    <TableCell>{actions("driver", e, name)}</TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={6} className="text-muted-foreground">{people.isLoading || loading ? "Carregando..." : "Nenhum motorista liberado."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="panel space-y-3 p-3">
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <Label className="block">Placas liberadas</Label>
            <p className="text-xs text-muted-foreground">{listedVehicles.filter((e) => e.active).length} ativa(s) · {vehicles.data?.length ?? 0} veículos cadastrados</p>
          </div>
          <AddPicker label="Placa" placeholder="Placa ou veículo" disabled={m.isPending}
            options={(vehicles.data ?? []).filter((v) => !takenVehicles.has(v.id)).map((v) => ({ id: v.id, text: v.model ? `${v.plate} - ${v.model}` : v.plate, hint: v.status === "inactive" ? "inativo" : undefined }))}
            onPick={(id) => m.mutate({ kind: "vehicle", id, action: "add" })} />
        </div>
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader><TableRow><TableHead>Placa</TableHead><TableHead>Veículo</TableHead><TableHead>Data de liberação</TableHead><TableHead>Data de exclusão</TableHead><TableHead>Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {listedVehicles.length ? listedVehicles.map((e) => {
                const v = vehicleById.get(e.id)!;
                return (
                  <TableRow key={e.id} className={e.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">{v.plate}</TableCell>
                    <TableCell>{v.model ?? "—"}{v.status === "inactive" && <Badge variant="outline" className="ml-2">veículo inativo</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.released_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.removed_at)}</TableCell>
                    <TableCell><StatusBadge entry={e} /></TableCell>
                    <TableCell>{actions("vehicle", e, v.model ? `${v.plate} - ${v.model}` : v.plate)}</TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={6} className="text-muted-foreground">{vehicles.isLoading || loading ? "Carregando..." : "Nenhuma placa liberada."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>
      <EditRelease target={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

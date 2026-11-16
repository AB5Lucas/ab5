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
import { normalizePlate } from "@/lib/fleet-costs";
import { titleCase } from "@/lib/fleet-notes";
import { applyColumnFilters, FilterHead, rowsForColumn, type ColumnDef, type ColumnFilters, type ColumnSort } from "@/components/column-filter";

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

/**
 * Uma liberação: `ref` = colaborador ou veículo cadastrado; sem `ref`, é um nome (motorista) ou uma placa + nome
 * do veículo digitados, fora do cadastro.
 */
export type ReleaseEntry = { id: string; ref: string | null; name: string | null; plate: string | null; released_at: string | null; removed_at: string | null; active: boolean };
/** Liberado no dia: marcado como ativo e o dia está entre a data de liberação e a de exclusão (as duas valem). */
export const releasedOn = (e: ReleaseEntry, day: string | null) =>
  e.active && (!day || ((!e.released_at || e.released_at <= day) && (!e.removed_at || day <= e.removed_at)));

/** Motoristas e placas liberados no posto: o nome e a placa escritos na nota casam primeiro com esta lista. */
export function useFleetRelease() {
  const drivers = useQuery({ queryKey: ["fleet-release-drivers"], queryFn: async () => (await supabase.from("fleet_release_drivers").select("id, collaborator_id, name, released_at, removed_at, active")).data ?? [] });
  const vehicles = useQuery({ queryKey: ["fleet-release-vehicles"], queryFn: async () => (await supabase.from("fleet_release_vehicles").select("id, vehicle_id, plate, label, released_at, removed_at, active")).data ?? [] });
  const driverList = useMemo<ReleaseEntry[]>(() => (drivers.data ?? []).map((d) => ({ id: d.id, ref: d.collaborator_id, name: d.name, plate: null, released_at: d.released_at, removed_at: d.removed_at, active: d.active })), [drivers.data]);
  const vehicleList = useMemo<ReleaseEntry[]>(() => (vehicles.data ?? []).map((v) => ({ id: v.id, ref: v.vehicle_id, name: v.label, plate: v.plate, released_at: v.released_at, removed_at: v.removed_at, active: v.active })), [vehicles.data]);
  return {
    drivers: driverList, vehicles: vehicleList,
    /** Colaboradores liberados no dia do abastecimento (ativo e dentro das datas). */
    driverIdsOn: (day: string | null) => new Set(driverList.filter((e) => e.ref && releasedOn(e, day)).map((e) => e.ref!)),
    /** Nomes digitados (fora do cadastro) liberados no dia. */
    freeNamesOn: (day: string | null) => driverList.filter((e) => !e.ref && e.name && releasedOn(e, day)).map((e) => e.name!),
    vehicleIdsOn: (day: string | null) => new Set(vehicleList.filter((e) => e.ref && releasedOn(e, day)).map((e) => e.ref!)),
    /** Placas digitadas (fora do cadastro) liberadas no dia. */
    freePlatesOn: (day: string | null) => vehicleList.filter((e) => !e.ref && e.plate && releasedOn(e, day)).map((e) => e.plate!),
    /** Nome do veículo das placas digitadas (para mostrar na tabela geral). */
    freeVehicleLabel: new Map(vehicleList.filter((e) => !e.ref && e.plate).map((e) => [normalizePlate(e.plate!), e.name])),
    isLoading: drivers.isLoading || vehicles.isLoading,
  };
}

/** Lista com busca; o que for digitado e não estiver na lista pode ser incluído assim mesmo (onFree). */
function AddPicker({ label, placeholder, options, onPick, onFree, freeLabel, disabled, value }: {
  label: string; placeholder: string; options: { id: string; text: string; hint?: string }[];
  onPick: (id: string) => void; onFree: (text: string) => void; freeLabel: (text: string) => string; disabled?: boolean;
  /** Dentro do formulário: mostra o escolhido no lugar do botão (+). */
  value?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const typed = q.trim();
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setQ(""); }}>
      <PopoverTrigger asChild>
        {value !== undefined
          ? <Button variant="outline" className="w-full justify-start font-normal" disabled={disabled}>{value || <span className="text-muted-foreground">{placeholder}</span>}</Button>
          : <Button size="sm" disabled={disabled}><Plus className="h-4 w-4" /> {label}</Button>}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{typed ? "Não está na lista." : "Nada encontrado."}</CommandEmpty>
            {typed && (
              <CommandGroup heading="Fora da lista">
                <CommandItem value={`__free__ ${typed}`} onSelect={() => { onFree(typed); setOpen(false); }}>
                  <Plus className="h-4 w-4" /> {freeLabel(typed)}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Cadastrados">
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
type AddOp = { kind: Kind; action: "add"; ref?: string; name?: string; plate?: string; released_at?: string | null; removed_at?: string | null; active?: boolean };
type RowOp = { kind: Kind; action: "delete" | "update"; id: string; patch?: Record<string, unknown> };
const TABLE = { driver: "fleet_release_drivers", vehicle: "fleet_release_vehicles" } as const;

function useReleaseWrite(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: AddOp | RowOp) => {
      const t = supabase.from(TABLE[op.kind]);
      let res;
      if (op.action === "add") {
        const row = op.kind === "driver"
          ? op.ref ? { collaborator_id: op.ref } : { name: titleCase(op.name!.trim()) }
          : op.ref ? { vehicle_id: op.ref } : { plate: normalizePlate(op.plate!), label: op.name?.trim() || null };
        res = await t.insert({ ...row, released_at: op.released_at === undefined ? today() : op.released_at, removed_at: op.removed_at ?? null, active: op.active ?? true } as never);
      } else if (op.action === "delete") res = await t.delete().eq("id", op.id);
      else res = await t.update(op.patch as never).eq("id", op.id);
      if (res.error) throw new Error(/duplicate|unique/i.test(res.error.message) ? "Já está na lista de liberação." : res.error.message);
    },
    onSuccess: (_, op) => {
      qc.invalidateQueries({ queryKey: [op.kind === "driver" ? "fleet-release-drivers" : "fleet-release-vehicles"] });
      toast.success(op.action === "add" ? "Liberado no posto." : op.action === "delete" ? "Retirado da lista." : "Liberação atualizada.");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

type EditTarget = { kind: Kind; entry: ReleaseEntry; title: string; free: boolean };

/** Editar uma liberação: datas, situação e, se for fora do cadastro, o nome (ou a placa e o nome do veículo). */
function EditRelease({ target, onClose }: { target: EditTarget | null; onClose: () => void }) {
  const [form, setForm] = useState({ released_at: "", removed_at: "", active: true, name: "", plate: "" });
  useEffect(() => {
    if (target) setForm({ released_at: target.entry.released_at ?? "", removed_at: target.entry.removed_at ?? "", active: target.entry.active, name: target.entry.name ?? "", plate: target.entry.plate ?? "" });
  }, [target?.kind, target?.entry.id]);
  const m = useReleaseWrite(onClose);
  if (!target) return null;
  const isVehicle = target.kind === "vehicle";
  const error = form.released_at && form.removed_at && form.removed_at < form.released_at ? "A data de exclusão não pode ser antes da data de liberação."
    : target.free && !isVehicle && !form.name.trim() ? "Informe o nome."
    : target.free && isVehicle && !normalizePlate(form.plate) ? "Informe a placa." : null;
  const patch: Record<string, unknown> = { released_at: form.released_at || null, removed_at: form.removed_at || null, active: form.active };
  if (target.free && !isVehicle) patch["name"] = titleCase(form.name.trim());
  if (target.free && isVehicle) { patch["plate"] = normalizePlate(form.plate); patch["label"] = form.name.trim() || null; }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar liberação</DialogTitle>
          <DialogDescription>{target.title}{target.free ? " · fora do cadastro" : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {target.free && !isVehicle && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="rel-name">Nome</Label>
              <Input id="rel-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          )}
          {target.free && isVehicle && (
            <>
              <div className="space-y-1">
                <Label htmlFor="rel-plate">Placa</Label>
                <Input id="rel-plate" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rel-label">Nome do veículo</Label>
                <Input id="rel-label" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </>
          )}
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
          <Button disabled={m.isPending || !!error} onClick={() => m.mutate({ kind: target.kind, id: target.entry.id, action: "update", patch })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PickOption = { id: string; text: string; hint?: string };
type AddTarget = { kind: Kind; options: PickOption[] };

/** Incluir motorista ou placa: mesmo formulário do Editar, com a escolha de quem (ou qual placa) no topo. */
function AddRelease({ target, onClose }: { target: AddTarget | null; onClose: () => void }) {
  const [sel, setSel] = useState<{ ref: string | null; text: string }>({ ref: null, text: "" });
  const [form, setForm] = useState({ released_at: today(), removed_at: "", active: true, name: "", plate: "" });
  useEffect(() => {
    if (target) { setSel({ ref: null, text: "" }); setForm({ released_at: today(), removed_at: "", active: true, name: "", plate: "" }); }
  }, [target?.kind]);
  const m = useReleaseWrite(onClose);
  if (!target) return null;
  const isVehicle = target.kind === "vehicle";
  const free = !sel.ref && !!sel.text;
  const error = !sel.ref && !sel.text ? (isVehicle ? "Escolha a placa." : "Escolha o motorista.")
    : form.released_at && form.removed_at && form.removed_at < form.released_at ? "A data de exclusão não pode ser antes da data de liberação."
    : free && !isVehicle && !form.name.trim() ? "Informe o nome."
    : free && isVehicle && !normalizePlate(form.plate) ? "Informe a placa." : null;
  const pickFree = (text: string) => {
    setSel({ ref: null, text: isVehicle ? `${normalizePlate(text) || text.toUpperCase()} (fora do cadastro)` : `${titleCase(text)} (fora do cadastro)` });
    setForm((f) => (isVehicle ? { ...f, plate: text.toUpperCase(), name: "" } : { ...f, name: titleCase(text) }));
  };
  const save = () => m.mutate({
    kind: target.kind, action: "add",
    ...(sel.ref ? { ref: sel.ref } : isVehicle ? { plate: form.plate, name: form.name } : { name: form.name }),
    released_at: form.released_at || null, removed_at: form.removed_at || null, active: form.active,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isVehicle ? "Incluir placa" : "Incluir motorista"}</DialogTitle>
          <DialogDescription>{isVehicle ? "Placa liberada para abastecer no posto." : "Motorista liberado para abastecer no posto."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label className="block">{isVehicle ? "Placa" : "Motorista"}</Label>
            <AddPicker label={isVehicle ? "Placa" : "Motorista"} placeholder={isVehicle ? "Placa ou veículo" : "Nome do motorista"} value={sel.text}
              options={target.options}
              onPick={(id) => setSel({ ref: id, text: target.options.find((o) => o.id === id)?.text ?? "" })}
              onFree={pickFree}
              freeLabel={(text) => (isVehicle ? `Incluir a placa ${normalizePlate(text) || text.toUpperCase()}` : `Incluir "${titleCase(text)}"`)} />
          </div>
          {free && !isVehicle && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="add-name">Nome</Label>
              <Input id="add-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          )}
          {free && isVehicle && (
            <>
              <div className="space-y-1">
                <Label htmlFor="add-plate">Placa</Label>
                <Input id="add-plate" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-label">Nome do veículo</Label>
                <Input id="add-label" value={form.name} placeholder="Ex.: Strada (terceiro)" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="add-from">Data de liberação</Label>
            <Input id="add-from" type="date" value={form.released_at} onChange={(e) => setForm({ ...form, released_at: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-to">Data de exclusão</Label>
            <Input id="add-to" type="date" value={form.removed_at}
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
        {error && sel.text !== "" && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending || !!error} onClick={save}>Incluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Placa digitada fora do cadastro: pede o nome do veículo antes de incluir. */
function FreeVehicleDialog({ plate, onClose }: { plate: string | null; onClose: () => void }) {
  const [form, setForm] = useState({ plate: "", name: "" });
  useEffect(() => { if (plate != null) setForm({ plate: plate.toUpperCase(), name: "" }); }, [plate]);
  const m = useReleaseWrite(onClose);
  if (plate == null) return null;
  const p = normalizePlate(form.plate);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Placa fora do cadastro</DialogTitle>
          <DialogDescription>Esta placa não está nos veículos cadastrados. Informe o nome do veículo para aparecer na tabela.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="free-plate">Placa</Label>
            <Input id="free-plate" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="free-label">Nome do veículo</Label>
            <Input id="free-label" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Strada (terceiro)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending || !p} onClick={() => m.mutate({ kind: "vehicle", action: "add", plate: p, name: form.name })}>Incluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Situação em texto (a mesma da etiqueta), para o filtro da coluna. */
const statusText = (entry: ReleaseEntry) => {
  const on = releasedOn(entry, today());
  return entry.active && !on ? (entry.removed_at && entry.removed_at < today() ? "Ativo (excluído)" : "Ativo (a partir da data)") : entry.active ? "Ativo" : "Inativo";
};

function StatusBadge({ entry }: { entry: ReleaseEntry }) {
  const on = releasedOn(entry, today());
  return entry.active && !on
    ? <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">{entry.removed_at && entry.removed_at < today() ? "Ativo (excluído)" : "Ativo (a partir da data)"}</Badge>
    : entry.active ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativo</Badge> : <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>;
}

const FreeBadge = () => <Badge variant="outline" className="ml-2 text-muted-foreground">fora do cadastro</Badge>;

/** Frota › Abastecimento › Liberação. */
export function FleetRelease() {
  const people = useCnhPeople();
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-release"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model, status").order("plate")).data ?? [] });
  const release = useFleetRelease();
  const m = useReleaseWrite();
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [freePlate, setFreePlate] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddTarget | null>(null);

  const personById = new Map((people.data ?? []).map((p) => [p.id, p]));
  const vehicleById = new Map((vehicles.data ?? []).map((v) => [v.id, v]));
  // Colaborador que perdeu a CNH no cadastro continua aparecendo pelo nome guardado (ou "colaborador").
  const driverName = (e: ReleaseEntry) => titleCase(e.ref ? personById.get(e.ref)?.full_name ?? e.name ?? "Colaborador" : e.name ?? "—");
  const vehicleText = (e: ReleaseEntry) => {
    const v = e.ref ? vehicleById.get(e.ref) : undefined;
    return { plate: v?.plate ?? e.plate ?? "—", model: v ? v.model : e.name };
  };
  const listedDrivers = [...release.drivers].sort((a, b) => Number(b.active) - Number(a.active) || driverName(a).localeCompare(driverName(b), "pt-BR"));
  const listedVehicles = [...release.vehicles].sort((a, b) => Number(b.active) - Number(a.active) || vehicleText(a).plate.localeCompare(vehicleText(b).plate));
  const takenDrivers = new Set(release.drivers.map((e) => e.ref).filter(Boolean));
  const takenVehicles = new Set(release.vehicles.map((e) => e.ref).filter(Boolean));
  const expired = (d: string | null) => !!d && d < today();
  const loading = release.isLoading;

  // Filtro e ordenação por coluna, como no Excel (igual à aba Abastecimentos).
  const [dFilters, setDFilters] = useState<ColumnFilters>({});
  const [dSort, setDSort] = useState<ColumnSort>(null);
  const [vFilters, setVFilters] = useState<ColumnFilters>({});
  const [vSort, setVSort] = useState<ColumnSort>(null);
  const cnhText = (e: ReleaseEntry) => {
    const p = e.ref ? personById.get(e.ref) : undefined;
    return p ? `${p.driver_license_category ?? "—"}${p.driver_license_expiry ? ` · ${brDate(p.driver_license_expiry)}` : ""}${expired(p.driver_license_expiry) ? " vencida" : ""}` : "—";
  };
  const driverCols: ColumnDef<ReleaseEntry>[] = [
    { key: "nome", label: "Nome", values: (e) => [driverName(e)], sort: (e) => driverName(e) },
    { key: "cnh", label: "CNH", values: (e) => [cnhText(e)], sort: (e) => (e.ref ? personById.get(e.ref)?.driver_license_expiry ?? null : null) },
    { key: "liberacao", label: "Data de liberação", values: (e) => [brDate(e.released_at)], sort: (e) => e.released_at },
    { key: "exclusao", label: "Data de exclusão", values: (e) => [brDate(e.removed_at)], sort: (e) => e.removed_at },
    { key: "situacao", label: "Situação", values: (e) => [statusText(e)] },
  ];
  const vehicleCols: ColumnDef<ReleaseEntry>[] = [
    { key: "placa", label: "Placa", values: (e) => [vehicleText(e).plate], sort: (e) => vehicleText(e).plate },
    { key: "veiculo", label: "Veículo", values: (e) => [vehicleText(e).model ?? "—"], sort: (e) => vehicleText(e).model ?? "" },
    { key: "liberacao", label: "Data de liberação", values: (e) => [brDate(e.released_at)], sort: (e) => e.released_at },
    { key: "exclusao", label: "Data de exclusão", values: (e) => [brDate(e.removed_at)], sort: (e) => e.removed_at },
    { key: "situacao", label: "Situação", values: (e) => [statusText(e)] },
  ];
  const shownDrivers = applyColumnFilters(listedDrivers, driverCols, dFilters, dSort);
  const shownVehicles = applyColumnFilters(listedVehicles, vehicleCols, vFilters, vSort);

  const actions = (kind: Kind, entry: ReleaseEntry, title: string) => (
    <div className="flex justify-end">
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${title}`} onClick={() => setEdit({ kind, entry, title, free: !entry.ref })}><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Apagar ${title}`} title="Apagar da lista (para guardar o histórico, prefira a data de exclusão)" disabled={m.isPending}
        onClick={() => { if (window.confirm(`Apagar ${title} da lista de liberação?`)) m.mutate({ kind, id: entry.id, action: "delete" }); }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Motoristas e placas liberados para abastecer no posto. Dá para incluir alguém ou uma placa fora do cadastro: digite na busca e escolha "Incluir". O nome escrito na nota vira o nome desta lista (se não achar aqui, de quem tem CNH cadastrada) e a placa vira a mais próxima (ex.: ECM8414 = ECM8E14). Cada nota usa quem estava ativo e liberado na data do abastecimento.
      </p>
      <section className="panel space-y-3 p-3">
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <Label className="block">Motoristas liberados</Label>
            <p className="text-xs text-muted-foreground">{listedDrivers.filter((e) => e.active).length} ativo(s) · {people.data?.length ?? 0} com CNH cadastrada</p>
          </div>
          <Button size="sm" disabled={m.isPending} onClick={() => setAdding({
            kind: "driver",
            options: (people.data ?? []).filter((p) => !takenDrivers.has(p.id)).map((p) => {
              const hint = [p.status === "inactive" ? "inativo" : null, expired(p.driver_license_expiry) ? "CNH vencida" : null].filter(Boolean).join(" · ");
              return hint ? { id: p.id, text: titleCase(p.full_name), hint } : { id: p.id, text: titleCase(p.full_name) };
            }),
          })}><Plus className="h-4 w-4" /> Motorista</Button>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader><TableRow>
              {driverCols.map((c) => <FilterHead key={c.key} column={c} rows={rowsForColumn(listedDrivers, driverCols, dFilters, c.key)} filters={dFilters} setFilters={setDFilters} sort={dSort} setSort={setDSort} />)}
              <TableHead className="w-20" />
            </TableRow></TableHeader>
            <TableBody>
              {shownDrivers.length ? shownDrivers.map((e) => {
                const p = e.ref ? personById.get(e.ref) : undefined;
                const name = driverName(e);
                return (
                  <TableRow key={e.id} className={e.active ? undefined : "text-muted-foreground"}>
                    <TableCell>{name}{!e.ref && <FreeBadge />}{p?.status === "inactive" && <Badge variant="outline" className="ml-2">colaborador inativo</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {p ? <>{p.driver_license_category ?? "—"}{p.driver_license_expiry ? ` · ${brDate(p.driver_license_expiry)}` : ""}{expired(p.driver_license_expiry) && <span className="ml-1 text-destructive">vencida</span>}</> : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.released_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.removed_at)}</TableCell>
                    <TableCell><StatusBadge entry={e} /></TableCell>
                    <TableCell>{actions("driver", e, name)}</TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={6} className="text-muted-foreground">{people.isLoading || loading ? "Carregando..." : listedDrivers.length ? "Nenhum motorista com esses filtros." : "Nenhum motorista liberado."}</TableCell></TableRow>}
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
          <Button size="sm" disabled={m.isPending} onClick={() => setAdding({
            kind: "vehicle",
            options: (vehicles.data ?? []).filter((v) => !takenVehicles.has(v.id)).map((v) => {
              const text = v.model ? `${v.plate} - ${v.model}` : v.plate;
              return v.status === "inactive" ? { id: v.id, text, hint: "inativo" } : { id: v.id, text };
            }),
          })}><Plus className="h-4 w-4" /> Placa</Button>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader><TableRow>
              {vehicleCols.map((c) => <FilterHead key={c.key} column={c} rows={rowsForColumn(listedVehicles, vehicleCols, vFilters, c.key)} filters={vFilters} setFilters={setVFilters} sort={vSort} setSort={setVSort} />)}
              <TableHead className="w-20" />
            </TableRow></TableHeader>
            <TableBody>
              {shownVehicles.length ? shownVehicles.map((e) => {
                const v = e.ref ? vehicleById.get(e.ref) : undefined;
                const t = vehicleText(e);
                return (
                  <TableRow key={e.id} className={e.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">{t.plate}{!e.ref && <FreeBadge />}</TableCell>
                    <TableCell>{t.model ?? "—"}{v?.status === "inactive" && <Badge variant="outline" className="ml-2">veículo inativo</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.released_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{brDate(e.removed_at)}</TableCell>
                    <TableCell><StatusBadge entry={e} /></TableCell>
                    <TableCell>{actions("vehicle", e, t.model ? `${t.plate} - ${t.model}` : t.plate)}</TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={6} className="text-muted-foreground">{vehicles.isLoading || loading ? "Carregando..." : listedVehicles.length ? "Nenhuma placa com esses filtros." : "Nenhuma placa liberada."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>
      <EditRelease target={edit} onClose={() => setEdit(null)} />
      <AddRelease target={adding} onClose={() => setAdding(null)} />
      <FreeVehicleDialog plate={freePlate} onClose={() => setFreePlate(null)} />
    </div>
  );
}

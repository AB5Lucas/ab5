import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const today = () => new Date().toISOString().slice(0, 10);

/** Colaboradores com CNH cadastrada (categoria ou validade), vencida ou não, ativos ou não. */
export function useCnhPeople() {
  return useQuery({
    queryKey: ["fleet-cnh-people"], staleTime: 5 * 60_000,
    queryFn: async () => ((await supabase.from("collaborators").select("id, full_name, status, driver_license_category, driver_license_expiry").order("full_name")).data ?? [])
      .filter((c) => c.driver_license_expiry || (c.driver_license_category ?? "").trim()),
  });
}

/** Motoristas e placas liberados no posto: o nome e a placa escritos na nota casam primeiro com esta lista. */
export function useFleetRelease() {
  const drivers = useQuery({ queryKey: ["fleet-release-drivers"], queryFn: async () => (await supabase.from("fleet_release_drivers").select("collaborator_id")).data ?? [] });
  const vehicles = useQuery({ queryKey: ["fleet-release-vehicles"], queryFn: async () => (await supabase.from("fleet_release_vehicles").select("vehicle_id")).data ?? [] });
  const driverIds = useMemo(() => new Set((drivers.data ?? []).map((d) => d.collaborator_id)), [drivers.data]);
  const vehicleIds = useMemo(() => new Set((vehicles.data ?? []).map((v) => v.vehicle_id)), [vehicles.data]);
  return {
    driverIds, vehicleIds,
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

/** Frota › Abastecimento › Liberação. */
export function FleetRelease() {
  const qc = useQueryClient();
  const people = useCnhPeople();
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-release"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model, status").order("plate")).data ?? [] });
  const release = useFleetRelease();
  const m = useMutation({
    mutationFn: async (op: { kind: "driver" | "vehicle"; id: string; add: boolean }) => {
      const res = op.kind === "driver"
        ? op.add ? await supabase.from("fleet_release_drivers").insert({ collaborator_id: op.id }) : await supabase.from("fleet_release_drivers").delete().eq("collaborator_id", op.id)
        : op.add ? await supabase.from("fleet_release_vehicles").insert({ vehicle_id: op.id }) : await supabase.from("fleet_release_vehicles").delete().eq("vehicle_id", op.id);
      if (res.error) throw res.error;
    },
    onSuccess: (_, op) => {
      qc.invalidateQueries({ queryKey: [op.kind === "driver" ? "fleet-release-drivers" : "fleet-release-vehicles"] });
      toast.success(op.add ? "Liberado no posto." : "Retirado da liberação.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listedPeople = (people.data ?? []).filter((p) => release.driverIds.has(p.id));
  const listedVehicles = (vehicles.data ?? []).filter((v) => release.vehicleIds.has(v.id));
  const expired = (d: string | null) => !!d && d < today();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Motoristas e placas liberados para abastecer no posto. O nome escrito na nota vira o nome completo de quem está nesta lista (e, se não achar aqui, de quem tem CNH cadastrada); a placa vira a placa cadastrada mais próxima (ex.: ECM8414 = ECM8E14), primeiro entre as liberadas.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-3">
          <div className="flex items-end justify-between gap-2">
            <div className="space-y-1">
              <Label className="block">Motoristas liberados</Label>
              <p className="text-xs text-muted-foreground">{listedPeople.length} de {people.data?.length ?? 0} com CNH cadastrada</p>
            </div>
            <AddPicker label="Motorista" placeholder="Nome do colaborador" disabled={m.isPending}
              options={(people.data ?? []).filter((p) => !release.driverIds.has(p.id)).map((p) => ({
                id: p.id, text: p.full_name, hint: [p.status === "inactive" ? "inativo" : null, expired(p.driver_license_expiry) ? "CNH vencida" : null].filter(Boolean).join(" · ") || undefined,
              }))}
              onPick={(id) => m.mutate({ kind: "driver", id, add: true })} />
          </div>
          <Table className="text-sm">
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>CNH</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {listedPeople.length ? listedPeople.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.full_name}{p.status === "inactive" && <Badge variant="outline" className="ml-2">inativo</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {p.driver_license_category ?? "—"}{p.driver_license_expiry ? ` · ${p.driver_license_expiry.split("-").reverse().join("/")}` : ""}
                    {expired(p.driver_license_expiry) && <span className="ml-1 text-destructive">vencida</span>}
                  </TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Retirar ${p.full_name}`} disabled={m.isPending} onClick={() => m.mutate({ kind: "driver", id: p.id, add: false })}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={3} className="text-muted-foreground">{people.isLoading || release.isLoading ? "Carregando..." : "Nenhum motorista liberado."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </section>

        <section className="panel space-y-3 p-3">
          <div className="flex items-end justify-between gap-2">
            <div className="space-y-1">
              <Label className="block">Placas liberadas</Label>
              <p className="text-xs text-muted-foreground">{listedVehicles.length} de {vehicles.data?.length ?? 0} veículos cadastrados</p>
            </div>
            <AddPicker label="Placa" placeholder="Placa ou veículo" disabled={m.isPending}
              options={(vehicles.data ?? []).filter((v) => !release.vehicleIds.has(v.id)).map((v) => ({ id: v.id, text: v.model ? `${v.plate} - ${v.model}` : v.plate, hint: v.status === "inactive" ? "inativo" : undefined }))}
              onPick={(id) => m.mutate({ kind: "vehicle", id, add: true })} />
          </div>
          <Table className="text-sm">
            <TableHeader><TableRow><TableHead>Placa</TableHead><TableHead>Veículo</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {listedVehicles.length ? listedVehicles.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.plate}</TableCell>
                  <TableCell>{v.model ?? "—"}{v.status === "inactive" && <Badge variant="outline" className="ml-2">inativo</Badge>}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Retirar ${v.plate}`} disabled={m.isPending} onClick={() => m.mutate({ kind: "vehicle", id: v.id, add: false })}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={3} className="text-muted-foreground">{vehicles.isLoading || release.isLoading ? "Carregando..." : "Nenhuma placa liberada."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Car, Copy, GripVertical, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Person = { collaborator_id: string; name: string };
const OWN = "__own__";
const POOL = "__pool__";
const NONE = "__none__";

export function TransportBuilderDialog({
  open,
  onOpenChange,
  date,
  clientId,
  clientName,
  dayLabel,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: string;
  clientId: string;
  clientName: string;
  dayLabel: string;
  people: Person[];
}) {
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["transport-builder", clientId, date],
    enabled: open && !!clientId,
    queryFn: async () => {
      const [{ data: vs }, { data: tp }, { data: drivers }] = await Promise.all([
        supabase
          .from("vehicle_schedules")
          .select("id, vehicle_id, driver_id, client_id, extra_client_ids, is_maintenance, vehicles(plate, brand, model, passenger_capacity)")
          .eq("schedule_date", date)
          .eq("is_maintenance", false)
          .or(`client_id.eq.${clientId},extra_client_ids.cs.{${clientId}}`),
        supabase.from("transport_passengers").select("id, vehicle_schedule_id, collaborator_id, created_at").eq("schedule_date", date).eq("client_id", clientId),
        supabase.from("collaborators").select("id, full_name").eq("is_driver", true).eq("status", "active").order("full_name"),
      ]);
      const cars = (vs ?? []).slice().sort((a, b) => (a.vehicles?.plate ?? "").localeCompare(b.vehicles?.plate ?? ""));
      return { cars, passengers: tp ?? [], drivers: drivers ?? [] };
    },
  });

  const cars = q.data?.cars ?? [];
  const passengers = q.data?.passengers ?? [];
  const drivers = q.data?.drivers ?? [];
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    drivers.forEach((d) => m.set(d.id, d.full_name));
    people.forEach((p) => m.set(p.collaborator_id, p.name));
    return m;
  }, [drivers, people]);

  const driverIds = new Set(cars.map((c) => c.driver_id).filter(Boolean) as string[]);
  const placed = new Map(passengers.map((p) => [p.collaborator_id, p.vehicle_schedule_id ?? OWN]));
  const pool = people
    .filter((p) => !placed.has(p.collaborator_id) && !driverIds.has(p.collaborator_id))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const inBox = (key: string) =>
    passengers
      .filter((p) => (p.vehicle_schedule_id ?? OWN) === key && !driverIds.has(p.collaborator_id))
      .map((p) => ({ collaborator_id: p.collaborator_id, name: nameOf.get(p.collaborator_id) ?? "—" }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["transport-builder"] });
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  const place = useMutation({
    mutationFn: async ({ collaboratorId, key }: { collaboratorId: string; key: string }) => {
      const { error } = await supabase.rpc("set_transport_passenger", {
        _date: date,
        _client_id: clientId,
        _vs_id: key === OWN || key === POOL ? (null as unknown as string) : key,
        _collaborator_id: collaboratorId,
        _remove: key === POOL,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const changeDriver = useMutation({
    mutationFn: async ({ vsId, driverId }: { vsId: string; driverId: string | null }) => {
      const { error } = await supabase.rpc("set_vehicle_driver", { _vs_id: vsId, _driver_id: driverId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Motorista atualizado também na aba Transporte");
      refresh();
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyPrev = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("copy_transport_prev", { _client_id: clientId, _date: date });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(n ? `${n} colaborador(es) copiados do dia anterior` : "Nada para copiar do dia anterior");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function drop(key: string) {
    setHover(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const current = placed.get(id) ?? POOL;
    if (current === key) return;
    if (key !== OWN && key !== POOL) {
      const car = cars.find((c) => c.id === key);
      const cap = car?.vehicles?.passenger_capacity ?? 0;
      if (cap > 0 && inBox(key).length >= cap) {
        toast.error(`Capacidade do carro atingida (${cap} passageiros).`);
        return;
      }
    }
    place.mutate({ collaboratorId: id, key });
  }

  const carLabel = (c: (typeof cars)[number]) =>
    [c.vehicles?.brand, c.vehicles?.model, c.vehicles?.plate].filter(Boolean).join(" ");

  const text = useMemo(() => {
    const lines = [`*${clientName.toUpperCase()} - TRANSPORTE*`, dayLabel, ""];
    const own = inBox(OWN);
    if (own.length) {
      lines.push("*Próprio*", ...own.map((p) => p.name), "");
    }
    cars.forEach((c) => {
      const list = inBox(c.id);
      lines.push(`*${carLabel(c)}*`);
      if (c.driver_id) lines.push(nameOf.get(c.driver_id) ?? "—");
      lines.push(...list.map((p) => p.name), "");
    });
    return lines.join("\n").trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars, passengers, nameOf, clientName, dayLabel]);

  const row = (p: Person) => (
    <li
      key={p.collaborator_id}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", p.collaborator_id); setDragId(p.collaborator_id); }}
      onDragEnd={() => setDragId(null)}
      className="flex cursor-grab items-center gap-1.5 px-2 py-1 text-xs"
    >
      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{p.name}</span>
    </li>
  );

  const zone = (key: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHover(key); },
    onDragLeave: () => setHover((h) => (h === key ? null : h)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Montar Transporte — {clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={copyPrev.isPending} onClick={() => copyPrev.mutate()}>
            <Copy className="h-4 w-4" /> Copiar dia anterior
          </Button>
          <Button
            size="sm"
            onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Transporte copiado"))}
          >
            <Copy className="h-4 w-4" /> Copiar texto
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
          <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <section {...zone(OWN)} className={cn("panel flex h-64 flex-col overflow-hidden", hover === OWN && "ring-2 ring-emerald-500")}>
              <header className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-2 py-1.5">
                <h3 className="font-display flex-1 text-[11px] font-semibold uppercase">Próprio (recebe VT)</h3>
                <Badge variant="outline" className="px-1 py-0 text-[10px]"><Users className="mr-0.5 h-2.5 w-2.5" />{inBox(OWN).length}</Badge>
              </header>
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">{inBox(OWN).map(row)}</ul>
            </section>
            {cars.map((c) => {
              const list = inBox(c.id);
              const cap = c.vehicles?.passenger_capacity ?? 0;
              return (
                <section key={c.id} {...zone(c.id)} className={cn("panel flex h-64 flex-col overflow-hidden", hover === c.id && "ring-2 ring-emerald-500")}>
                  <header className="space-y-1 border-b border-border bg-secondary/60 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Car className="h-3 w-3" />
                      <h3 className="font-display flex-1 truncate text-[11px] font-semibold uppercase">{carLabel(c)}</h3>
                      <Badge variant={cap > 0 && list.length >= cap ? "destructive" : "outline"} className="px-1 py-0 text-[10px]">
                        {list.length}{cap > 0 ? `/${cap}` : ""}
                      </Badge>
                    </div>
                    <Select
                      value={c.driver_id ?? NONE}
                      onValueChange={(v) => changeDriver.mutate({ vsId: c.id, driverId: v === NONE ? null : v })}
                    >
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Motorista" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem motorista</SelectItem>
                        {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </header>
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">{list.map(row)}</ul>
                </section>
              );
            })}
            {cars.length === 0 && !q.isLoading && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground sm:col-span-2">
                Nenhum carro escalado para este cliente neste dia na aba Transporte.
              </p>
            )}
          </div>
          <aside {...zone(POOL)} className={cn("panel flex max-h-[60vh] flex-col overflow-hidden", hover === POOL && "ring-2 ring-emerald-500")}>
            <header className="border-b border-border bg-secondary/60 px-3 py-2">
              <p className="font-display text-xs font-semibold uppercase">Sem transporte</p>
              <p className="text-[11px] text-muted-foreground">{pool.length} colaborador(es)</p>
            </header>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">{pool.map(row)}</ul>
          </aside>
        </div>
        <Textarea readOnly value={text} rows={8} className="font-mono text-xs" />
      </DialogContent>
    </Dialog>
  );
}

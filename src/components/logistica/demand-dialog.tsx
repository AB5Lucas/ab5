import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/search-select";
import { cn } from "@/lib/utils";
import { CARRIER_LABEL, cnhCovers, demandAlerts, kg, KIND_LABEL, loadSummary, suggestVehicles } from "@/lib/logistics";
import { LOG_KEY, transportConflict, useLogData, useTransportBusy, type DemandRow } from "./use-log-data";

const NONE = "__none__";
type ItemDraft = { material_id: string | null; description: string; qty: string; unit_weight_kg: string; length_m: string; unit_volume_m3: string };
const n = (s: string) => Number(String(s).replace(",", ".")) || 0;
const nOrNull = (s: string) => (s.trim() === "" ? null : n(s));
const str = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const todayISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/** Nova demanda / editar: carga (materiais), cálculo, veículo sugerido, programação e alertas ao vivo. */
export type DemandPreset = { date?: string | undefined; start?: string | undefined; end?: string | undefined; vehicleId?: string | undefined; carrier?: string | undefined };
const plus1h = (t: string) => { const [h, m] = t.split(":").map(Number); const x = Math.min(23 * 60 + 59, h! * 60 + m! + 60); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

export function DemandDialog({ open, onOpenChange, demand, preset, overlap }: {
  open: boolean; onOpenChange: (o: boolean) => void; demand?: DemandRow | null | undefined; preset?: DemandPreset | undefined;
  /** Sobreposição de horário já calculada pela agenda (mesmo veículo / mesmo local). */
  overlap?: { vehicle: number; place: number } | undefined;
}) {
  const qc = useQueryClient();
  const { base } = useLogData();
  const b = base.data;
  const blank = { kind: "entregar", title: "", client_id: NONE, origin_id: NONE, dest_id: NONE, due_date: "", contact: "", notes: "", scheduled_date: "", departure_time: "", end_time: "", vehicle_id: NONE, driver_id: NONE, trips: "1", carrier: "ab5", carrier_name: "", carrier_plate: "", carrier_driver: "", carrier_phone: "" };
  const [f, setF] = useState(blank);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? demand?.id ?? `new-${JSON.stringify(preset ?? {})}` : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (open) {
      setF(demand ? {
        kind: demand.kind, title: demand.title, client_id: demand.client_id ?? NONE, origin_id: demand.origin_id ?? NONE, dest_id: demand.dest_id ?? NONE,
        due_date: demand.due_date ?? "", contact: demand.contact ?? "", notes: demand.notes ?? "", scheduled_date: demand.scheduled_date ?? "",
        departure_time: demand.departure_time?.slice(0, 5) ?? "", end_time: demand.end_time?.slice(0, 5) ?? "", vehicle_id: demand.vehicle_id ?? NONE, driver_id: demand.driver_id ?? NONE, trips: String(demand.trips ?? 1),
        carrier: demand.carrier ?? "ab5", carrier_name: demand.carrier_name ?? "", carrier_plate: demand.carrier_plate ?? "", carrier_driver: demand.carrier_driver ?? "", carrier_phone: demand.carrier_phone ?? "",
      } : {
        ...blank, scheduled_date: preset?.date ?? "", departure_time: preset?.start ?? "", end_time: preset?.end ?? (preset?.start ? plus1h(preset.start) : ""),
        vehicle_id: preset?.vehicleId ?? NONE, carrier: preset?.carrier ?? "ab5", kind: preset?.carrier && preset.carrier !== "ab5" ? "receber" : "entregar",
      });
      setItems(demand ? demand.items.map((i) => ({ material_id: i.material_id, description: i.description, qty: str(i.qty), unit_weight_kg: str(i.unit_weight_kg), length_m: str(i.length_m), unit_volume_m3: str(i.unit_volume_m3) })) : []);
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const logItems = useMemo(() => items.map((i) => ({ description: i.description, qty: n(i.qty), unit_weight_kg: n(i.unit_weight_kg), length_m: nOrNull(i.length_m), unit_volume_m3: nOrNull(i.unit_volume_m3) })), [items]);
  const load = loadSummary(logItems);
  const suggestions = useMemo(() => suggestVehicles(load, b?.vehicles.filter((v) => v.status !== "inactive") ?? []), [load.weight, load.volume, load.maxLength, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = f.carrier === "ab5";
  const vehicle = own ? b?.vehicles.find((v) => v.id === f.vehicle_id) ?? null : null;
  const isScheduled = !!f.scheduled_date && (own ? f.vehicle_id !== NONE : !!f.departure_time);
  const drivers = (b?.drivers ?? []).filter((d) => !vehicle || cnhCovers(d.driver_license_category, vehicle.cnh_category));
  const driver = b?.drivers.find((d) => d.id === f.driver_id) ?? null;
  const origin = b?.addresses.find((a) => a.id === f.origin_id) ?? null;
  const dest = b?.addresses.find((a) => a.id === f.dest_id) ?? null;
  const busy = useTransportBusy(f.scheduled_date || "0000-01-01", f.scheduled_date || "0000-01-01");
  const alerts = demandAlerts(
    { id: demand?.id ?? "new", kind: f.kind, title: f.title, status: isScheduled ? "programada" : "pendente", due_date: f.due_date || null, end_time: f.end_time || null,
      carrier: f.carrier, carrier_plate: f.carrier_plate || null, carrier_phone: f.carrier_phone || null,
      scheduled_date: f.scheduled_date || null, departure_time: f.departure_time || null, vehicle_id: f.vehicle_id === NONE ? null : f.vehicle_id,
      driver_id: f.driver_id === NONE ? null : f.driver_id, trips: Math.max(1, n(f.trips)), origin_id: null, dest_id: null, contact: null, notes: null, message_sent_at: demand?.message_sent_at ?? null },
    { today: todayISO(), now: new Date(), items: logItems, vehicle, driver, origin, dest, rules: b?.rules ?? [],
      ...(vehicle ? transportConflict(busy.data, vehicle.id, f.driver_id === NONE ? null : f.driver_id, f.scheduled_date || null) : {}), overlapVehicle: overlap?.vehicle, overlapPlace: overlap?.place },
  );
  // Ao escolher o veículo, as viagens vêm do cálculo (dá para mudar).
  const pickVehicle = (id: string) => { const sg = suggestions.find((x) => x.vehicle.id === id); setF((x) => ({ ...x, vehicle_id: id, trips: sg ? String(sg.trips) : x.trips })); };

  const save = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Dê um nome para a demanda.");
      const scheduled = isScheduled;
      if (f.end_time && f.departure_time && f.end_time <= f.departure_time) throw new Error("O fim precisa ser depois do início.");
      const row = {
        kind: f.kind, title: f.title.trim(), client_id: f.client_id === NONE ? null : f.client_id, origin_id: f.origin_id === NONE ? null : f.origin_id,
        dest_id: f.dest_id === NONE ? null : f.dest_id, due_date: f.due_date || null, contact: f.contact.trim() || null, notes: f.notes.trim() || null,
        scheduled_date: f.scheduled_date || null, departure_time: f.departure_time || null, end_time: f.end_time || null,
        vehicle_id: own && f.vehicle_id !== NONE ? f.vehicle_id : null, driver_id: own && f.driver_id !== NONE ? f.driver_id : null, trips: Math.max(1, Math.round(n(f.trips))),
        carrier: f.carrier, carrier_name: own ? null : f.carrier_name.trim() || null, carrier_plate: own ? null : f.carrier_plate.trim().toUpperCase() || null,
        carrier_driver: own ? null : f.carrier_driver.trim() || null, carrier_phone: own ? null : f.carrier_phone.trim() || null,
        status: demand?.status === "concluida" ? "concluida" : scheduled ? "programada" : "pendente", updated_at: new Date().toISOString(),
      };
      let id = demand?.id;
      if (id) { const { error } = await supabase.from("log_demands").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("log_demands").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      const { error: de } = await supabase.from("log_demand_items").delete().eq("demand_id", id!);
      if (de) throw de;
      const rows = items.filter((i) => i.description.trim() && n(i.qty) > 0).map((i) => ({
        demand_id: id!, material_id: i.material_id, description: i.description.trim(), qty: n(i.qty), unit_weight_kg: n(i.unit_weight_kg),
        length_m: nOrNull(i.length_m), unit_volume_m3: nOrNull(i.unit_volume_m3),
      }));
      if (rows.length) { const { error } = await supabase.from("log_demand_items").insert(rows); if (error) throw error; }
      return scheduled;
    },
    onSuccess: (scheduled) => { toast.success(scheduled ? "Demanda programada" : "Demanda salva"); qc.invalidateQueries({ queryKey: LOG_KEY }); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addrOptions = [{ value: NONE, label: "—" }, ...(b?.addresses ?? []).filter((a) => a.active).map((a) => ({ value: a.id, label: `${a.name} · ${a.city}` }))];
  const patchItem = (i: number, p: Partial<ItemDraft>) => setItems((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>{demand ? "Demanda de logística" : "Nova demanda de logística"}</DialogTitle>
          <DialogDescription>Informe quem transporta, o horário e a carga: o sistema soma peso e medidas, sugere o veículo e mostra os alertas. Sem data (e sem veículo, quando é nosso), fica na fila para programar.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label className="block">Quem transporta</Label>
            <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Quem transporta">
              {Object.entries(CARRIER_LABEL).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={f.carrier === k} onClick={() => set("carrier", k)}
                  className={cn("rounded px-3 py-1 text-sm", f.carrier === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label className="block">Tipo</Label>
              <Select value={f.kind} onValueChange={(v) => set("kind", v)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="ld-title">Demanda</Label><Input id="ld-title" placeholder="Ex.: Andaime para a Suzano" value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
            <div className="space-y-1"><Label className="block">Cliente</Label>
              <SearchSelect value={f.client_id} onChange={(v) => set("client_id", v)} searchPlaceholder="Digite o cliente" options={[{ value: NONE, label: "—" }, ...(b?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></div>
            <div className="space-y-1"><Label className="block">Carregar em</Label><SearchSelect value={f.origin_id} onChange={(v) => set("origin_id", v)} searchPlaceholder="Digite o local" options={addrOptions} /></div>
            <div className="space-y-1"><Label className="block">Descarregar em</Label><SearchSelect value={f.dest_id} onChange={(v) => set("dest_id", v)} searchPlaceholder="Digite o local" options={addrOptions} /></div>
            <div className="space-y-1"><Label htmlFor="ld-due">Precisa até</Label><Input id="ld-due" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ld-contact">Contato no local</Label><Input id="ld-contact" value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Nome e telefone" /></div>
            <div className="space-y-1"><Label htmlFor="ld-notes">Observações</Label><Input id="ld-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Ex.: levar cinta" /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <Label className="block">Carga</Label>
              <div className="flex gap-2">
                <SearchSelect className="h-9 w-64" value="" placeholder="+ Material do cadastro" searchPlaceholder="Digite o material"
                  onChange={(id) => { const m = b?.materials.find((x) => x.id === id); if (m) setItems((s) => [...s, { material_id: m.id, description: m.name, qty: "1", unit_weight_kg: str(m.weight_kg), length_m: str(m.length_m), unit_volume_m3: str(m.volume_m3) }]); }}
                  options={(b?.materials ?? []).filter((m) => m.active).map((m) => ({ value: m.id, label: m.name, hint: `${m.weight_kg} kg` }))} />
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setItems((s) => [...s, { material_id: null, description: "", qty: "1", unit_weight_kg: "", length_m: "", unit_volume_m3: "" }])}><Plus className="h-4 w-4" /> Item avulso</Button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="text-xs">
                <TableHeader><TableRow><TableHead>Material</TableHead><TableHead className="w-20">Qtd</TableHead><TableHead className="w-24">Peso un. (kg)</TableHead><TableHead className="w-24">Comp. (m)</TableHead><TableHead className="w-24">Vol. un. (m³)</TableHead><TableHead className="w-24 text-right">Peso</TableHead><TableHead className="w-8" /></TableRow></TableHeader>
                <TableBody>
                  {!items.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Inclua os materiais da carga.</TableCell></TableRow>}
                  {items.map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Input className="h-8" value={i.description} onChange={(e) => patchItem(idx, { description: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8" inputMode="decimal" value={i.qty} onChange={(e) => patchItem(idx, { qty: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8" inputMode="decimal" value={i.unit_weight_kg} onChange={(e) => patchItem(idx, { unit_weight_kg: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8" inputMode="decimal" value={i.length_m} onChange={(e) => patchItem(idx, { length_m: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8" inputMode="decimal" value={i.unit_volume_m3} onChange={(e) => patchItem(idx, { unit_volume_m3: e.target.value })} /></TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{kg(n(i.qty) * n(i.unit_weight_kg))}</TableCell>
                      <TableCell><Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Tirar item" onClick={() => setItems((s) => s.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {items.length > 0 && (
                  <TableFooter><TableRow><TableCell colSpan={3} className="font-semibold">Total</TableCell><TableCell className="tabular-nums">maior {load.maxLength.toLocaleString("pt-BR")} m</TableCell><TableCell className="tabular-nums">{load.volume.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m³</TableCell><TableCell className="text-right font-semibold tabular-nums">{kg(load.weight)}</TableCell><TableCell /></TableRow></TableFooter>
                )}
              </Table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {own ? (
            <div className="space-y-2">
              <Label className="block">Veículo sugerido</Label>
              {!suggestions.length && <p className="text-xs text-muted-foreground">Cadastre a carga útil dos veículos (aba Veículos) para o sistema sugerir.</p>}
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {suggestions.slice(0, 6).map((s) => (
                  <button type="button" key={s.vehicle.id} onClick={() => pickVehicle(s.vehicle.id)}
                    className={cn("w-full rounded-md border p-2 text-left text-xs", f.vehicle_id === s.vehicle.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
                    <div className="flex justify-between font-medium"><span>{[s.vehicle.model, s.vehicle.plate].filter(Boolean).join(" · ")}</span><span className={s.fits ? "text-emerald-600" : "text-destructive"}>{s.fits ? "Atende" : "Não atende"}</span></div>
                    <div className="text-muted-foreground">{kg(Number(s.vehicle.cargo_capacity_kg))}{s.vehicle.bed_length_m ? ` · ${s.vehicle.bed_length_m} m` : ""} · {s.reason}</div>
                  </button>
                ))}
              </div>
            </div>
            ) : (
            <div className="grid content-start grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1"><Label htmlFor="ld-cn">{f.carrier === "cliente" ? "Empresa (cliente)" : "Empresa (terceiro / fornecedor)"}</Label><Input id="ld-cn" value={f.carrier_name} onChange={(e) => set("carrier_name", e.target.value)} placeholder={b?.clients.find((c) => c.id === f.client_id)?.name ?? "Nome da empresa"} /></div>
              <div className="space-y-1"><Label htmlFor="ld-cp">Placa</Label><Input id="ld-cp" value={f.carrier_plate} onChange={(e) => set("carrier_plate", e.target.value.toUpperCase())} placeholder="Opcional" /></div>
              <div className="space-y-1"><Label htmlFor="ld-cd">Motorista</Label><Input id="ld-cd" value={f.carrier_driver} onChange={(e) => set("carrier_driver", e.target.value)} placeholder="Opcional" /></div>
              <div className="col-span-2 space-y-1"><Label htmlFor="ld-ct">Telefone</Label><Input id="ld-ct" value={f.carrier_phone} onChange={(e) => set("carrier_phone", e.target.value)} placeholder="Para mandar a mensagem da véspera" /></div>
            </div>
            )}
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label htmlFor="ld-date">Data</Label><Input id="ld-date" type="date" value={f.scheduled_date} onChange={(e) => set("scheduled_date", e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="ld-time">Início</Label><Input id="ld-time" type="time" step={900} value={f.departure_time} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, departure_time: v, end_time: !x.end_time || x.end_time <= v ? (v ? plus1h(v) : "") : x.end_time })); }} /></div>
                <div className="space-y-1"><Label htmlFor="ld-end">Fim</Label><Input id="ld-end" type="time" step={900} value={f.end_time} onChange={(e) => set("end_time", e.target.value)} /></div>
                {own && <>
                <div className="col-span-2 space-y-1"><Label className="block">Veículo</Label>
                  <SearchSelect value={f.vehicle_id} onChange={pickVehicle} searchPlaceholder="Digite a placa ou modelo"
                    options={[{ value: NONE, label: "Definir" }, ...(b?.vehicles ?? []).filter((v) => v.status !== "inactive").map((v) => ({ value: v.id, label: [v.model, v.plate].filter(Boolean).join(" · ") }))]} /></div>
                <div className="space-y-1"><Label htmlFor="ld-trips">Viagens</Label><Input id="ld-trips" inputMode="numeric" value={f.trips} onChange={(e) => set("trips", e.target.value.replace(/\D/g, ""))} /></div>
                <div className="col-span-3 space-y-1"><Label className="block">Motorista</Label>
                  <SearchSelect value={f.driver_id} onChange={(v) => set("driver_id", v)} searchPlaceholder="Digite o nome"
                    options={[{ value: NONE, label: "Definir" }, ...drivers.map((d) => ({ value: d.id, label: d.full_name, hint: `CNH ${d.driver_license_category ?? "?"}` }))]} />
                  {vehicle?.cnh_category && <p className="text-[11px] text-muted-foreground">Só motoristas com CNH que cobre a categoria {vehicle.cnh_category}.</p>}
                </div>
                </>}
              </div>
              <div className="space-y-1">
                <Label className="block">Alertas</Label>
                {!alerts.length ? <p className="text-xs text-emerald-600">Nenhum alerta.</p> : (
                  <ul className="space-y-1 text-xs">
                    {alerts.map((a, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", a.tone === "red" ? "bg-destructive" : "bg-orange-500")} />{a.text}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{isScheduled ? "Salvar na agenda" : "Salvar na fila"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

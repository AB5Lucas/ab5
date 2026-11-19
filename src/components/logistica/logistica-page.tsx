import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, MessageCircle, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/search-select";
import { cn } from "@/lib/utils";
import { CARRIER_LABEL, isOwn, kg, KIND_LABEL, loadSummary } from "@/lib/logistics";
import { DemandDialog } from "./demand-dialog";
import { addDays, AgendaTab, br, MessageDialog, todayISO, toneOf, useAlerts } from "./agenda";
import { LOG_KEY, useLogData, type Address, type DemandRow, type Material, type Vehicle } from "./use-log-data";

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")) || 0);
const STATUS_LABEL: Record<string, string> = { pendente: "Na fila", programada: "Programada", concluida: "Concluída", cancelada: "Cancelada" };

export function LogisticaPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Logística" description="Agenda de carga, descarga e busca de material, hora a hora: nossos veículos e também o cliente ou terceiro que vem em determinado horário. Com os materiais, o sistema soma peso e medidas, sugere o veículo, avisa restrições (peso, carroceria, rodízio, CNH, horário batendo, conflito com a Transporte) e monta a mensagem da véspera." />
      <Tabs pageTabs defaultValue="programacao">
        <TabsList>
          <TabsTrigger value="programacao">Agenda</TabsTrigger>
          <TabsTrigger value="demandas">Demandas</TabsTrigger>
          <TabsTrigger value="materiais">Materiais</TabsTrigger>
          <TabsTrigger value="veiculos">Veículos</TabsTrigger>
          <TabsTrigger value="enderecos">Endereços</TabsTrigger>
        </TabsList>
        <TabsContent value="programacao" className="mt-4"><AgendaTab /></TabsContent>
        <TabsContent value="demandas" className="mt-4"><DemandsTab /></TabsContent>
        <TabsContent value="materiais" className="mt-4"><MaterialsTab /></TabsContent>
        <TabsContent value="veiculos" className="mt-4"><VehiclesTab /></TabsContent>
        <TabsContent value="enderecos" className="mt-4"><AddressesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function useDemandActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from("log_demands").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LOG_KEY }),
    onError: (e: Error) => toast.error(e.message),
  });
}

function DemandsTab() {
  const { base, demands } = useLogData();
  const act = useDemandActions();
  const qc = useQueryClient();
  const [status, setStatus] = useState("abertas");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ demand?: DemandRow | null } | null>(null);
  const [msg, setMsg] = useState<DemandRow | null>(null);
  const rows = (demands.data ?? []).filter((d) => (status === "abertas" ? d.status === "pendente" || d.status === "programada" : status === "todas" || d.status === status)
    && (!q || d.title.toLowerCase().includes(q.toLowerCase())));
  const alerts = useAlerts(rows, todayISO(), addDays(todayISO(), 60));
  const b = base.data;
  const name = (list: { id: string; name?: string; full_name?: string; plate?: string }[] | undefined, id: string | null) => {
    const x = list?.find((i) => i.id === id); return x ? x.name ?? x.full_name ?? x.plate ?? "" : "—";
  };
  const del = async (d: DemandRow) => {
    if (!confirm(`Apagar a demanda "${d.title}"?`)) return;
    const { error } = await supabase.from("log_demands").delete().eq("id", d.id);
    if (error) toast.error(error.message); else { toast.success("Demanda apagada"); qc.invalidateQueries({ queryKey: LOG_KEY }); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="block">Mostrar</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="abertas">Em aberto</SelectItem><SelectItem value="pendente">Na fila</SelectItem><SelectItem value="programada">Programadas</SelectItem><SelectItem value="concluida">Concluídas</SelectItem><SelectItem value="cancelada">Canceladas</SelectItem><SelectItem value="todas">Todas</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="ld-q">Buscar</Label><Input id="ld-q" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome da demanda" /></div>
        <div className="flex-1" />
        <Button onClick={() => setEdit({})}><Plus className="h-4 w-4" /> Nova demanda</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader><TableRow>
            <TableHead>Demanda</TableHead><TableHead>Ações</TableHead><TableHead>Tipo</TableHead><TableHead>Cliente</TableHead><TableHead>Carregar → Descarregar</TableHead><TableHead className="text-right">Peso</TableHead>
            <TableHead>Prazo</TableHead><TableHead>Data</TableHead><TableHead>Veículo / quem vem</TableHead><TableHead>Motorista</TableHead><TableHead>Situação</TableHead><TableHead>Alertas</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">Nenhuma demanda.</TableCell></TableRow>}
            {rows.map((d) => {
              const al = alerts.get(d.id) ?? [];
              const t = toneOf(al);
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium"><button type="button" className="text-left hover:underline" onClick={() => setEdit({ demand: d })}>{d.title}</button></TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => setEdit({ demand: d })}><Pencil className="h-3.5 w-3.5" /></Button>
                    {d.status === "programada" && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mensagem ao motorista" onClick={() => setMsg(d)}><MessageCircle className="h-3.5 w-3.5" /></Button>}
                    {d.status === "programada" && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Concluir" onClick={() => act.mutate({ id: d.id, patch: { status: "concluida" } })}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></Button>}
                    {(d.status === "pendente" || d.status === "programada") && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancelar" onClick={() => confirm("Cancelar a demanda?") && act.mutate({ id: d.id, patch: { status: "cancelada" } })}><XCircle className="h-3.5 w-3.5" /></Button>}
                    {(d.status === "concluida" || d.status === "cancelada") && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => act.mutate({ id: d.id, patch: { status: d.scheduled_date && (isOwn(d) ? d.vehicle_id : d.departure_time) ? "programada" : "pendente" } })}>Reabrir</Button>}
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Apagar" onClick={() => void del(d)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </TableCell>
                  <TableCell>{KIND_LABEL[d.kind]}</TableCell>
                  <TableCell>{name(b?.clients, d.client_id)}</TableCell>
                  <TableCell>{name(b?.addresses, d.origin_id)} → {name(b?.addresses, d.dest_id)}</TableCell>
                  <TableCell className="text-right tabular-nums">{kg(loadSummary(d.items).weight)}</TableCell>
                  <TableCell>{br(d.due_date)}</TableCell>
                  <TableCell>{br(d.scheduled_date)}{d.departure_time ? ` ${d.departure_time.slice(0, 5)}${d.end_time ? `–${d.end_time.slice(0, 5)}` : ""}` : ""}</TableCell>
                  <TableCell>{isOwn(d) ? name(b?.vehicles, d.vehicle_id) : `${CARRIER_LABEL[d.carrier ?? "cliente"]}${d.carrier_plate ? ` · ${d.carrier_plate}` : ""}`}</TableCell>
                  <TableCell>{isOwn(d) ? name(b?.drivers, d.driver_id) : d.carrier_driver || d.carrier_name || "—"}</TableCell>
                  <TableCell>{STATUS_LABEL[d.status]}{d.message_sent_at ? " · msg enviada" : ""}</TableCell>
                  <TableCell title={al.map((a) => a.text).join("\n")}>{t ? <span className={cn("font-medium", t === "red" ? "text-destructive" : "text-orange-600")}>{al.length}</span> : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <DemandDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} demand={edit?.demand} />
      <MessageDialog demand={msg} onClose={() => setMsg(null)} />
    </div>
  );
}

/** Cadastro simples (materiais e endereços): lista + formulário. */
function useSave(table: "log_materials" | "log_addresses", label: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, row }: { id?: string | undefined; row: Record<string, unknown> }) => {
      const { error } = id ? await supabase.from(table).update(row as never).eq("id", id) : await supabase.from(table).insert(row as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${label} salvo`); qc.invalidateQueries({ queryKey: LOG_KEY }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

function MaterialsTab() {
  const { base } = useLogData();
  const save = useSave("log_materials", "Material");
  const [edit, setEdit] = useState<Partial<Material> | null>(null);
  const [f, setF] = useState({ name: "", unit: "UN", weight_kg: "", length_m: "", volume_m3: "", active: true });
  const openEdit = (m: Partial<Material>) => {
    setEdit(m);
    setF({ name: m.name ?? "", unit: m.unit ?? "UN", weight_kg: m.weight_kg != null ? String(m.weight_kg).replace(".", ",") : "", length_m: m.length_m != null ? String(m.length_m).replace(".", ",") : "", volume_m3: m.volume_m3 != null ? String(m.volume_m3).replace(".", ",") : "", active: m.active ?? true });
  };
  const list = base.data?.materials ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Peso e medidas por unidade. Ao lançar a demanda, o material já traz esses valores.</p>
        <Button onClick={() => openEdit({})}><Plus className="h-4 w-4" /> Novo material</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Ações</TableHead><TableHead>Unidade</TableHead><TableHead className="text-right">Peso un. (kg)</TableHead><TableHead className="text-right">Comprimento (m)</TableHead><TableHead className="text-right">Volume un. (m³)</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {!list.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhum material cadastrado.</TableCell></TableRow>}
            {list.map((m) => (
              <TableRow key={m.id} className={cn(!m.active && "opacity-50")}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                <TableCell>{m.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(m.weight_kg).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right tabular-nums">{m.length_m != null ? Number(m.length_m).toLocaleString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{m.volume_m3 != null ? Number(m.volume_m3).toLocaleString("pt-BR") : "—"}</TableCell>
                <TableCell>{m.active ? "Ativo" : "Inativo"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar material" : "Novo material"}</DialogTitle><DialogDescription>Valores por unidade.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label htmlFor="lm-name">Material</Label><Input id="lm-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Tubo de andaime 6 m" /></div>
            <div className="space-y-1"><Label htmlFor="lm-unit">Unidade</Label><Input id="lm-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1"><Label htmlFor="lm-w">Peso un. (kg)</Label><Input id="lm-w" inputMode="decimal" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lm-l">Comprimento (m)</Label><Input id="lm-l" inputMode="decimal" value={f.length_m} onChange={(e) => setF({ ...f, length_m: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lm-v">Volume un. (m³)</Label><Input id="lm-v" inputMode="decimal" value={f.volume_m3} onChange={(e) => setF({ ...f, volume_m3: e.target.value })} /></div>
            <div className="col-span-2 flex items-center gap-2"><Switch id="lm-a" checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /><Label htmlFor="lm-a">Ativo</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate({ id: edit?.id, row: { name: f.name.trim(), unit: f.unit.trim() || "UN", weight_kg: num(f.weight_kg) ?? 0, length_m: num(f.length_m), volume_m3: num(f.volume_m3), active: f.active } }, { onSuccess: () => setEdit(null) })}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddressesTab() {
  const { base } = useLogData();
  const save = useSave("log_addresses", "Endereço");
  const [edit, setEdit] = useState<Partial<Address> | null>(null);
  const empty = { name: "", client_id: "__none__", street: "", city: "", uf: "SP", receive_from: "", receive_to: "", needs_booking: false, notes: "", active: true };
  const [f, setF] = useState(empty);
  const openEdit = (a: Partial<Address>) => {
    setEdit(a);
    setF(a.id ? { name: a.name ?? "", client_id: a.client_id ?? "__none__", street: a.street ?? "", city: a.city ?? "", uf: a.uf ?? "SP", receive_from: a.receive_from?.slice(0, 5) ?? "", receive_to: a.receive_to?.slice(0, 5) ?? "", needs_booking: !!a.needs_booking, notes: a.notes ?? "", active: a.active ?? true } : empty);
  };
  const list = base.data?.addresses ?? [];
  const clients = base.data?.clients ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Locais de carga e descarga. A cidade liga o rodízio; o horário de recebimento e o agendamento geram alertas.</p>
        <Button onClick={() => openEdit({})}><Plus className="h-4 w-4" /> Novo endereço</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader><TableRow><TableHead>Local</TableHead><TableHead>Ações</TableHead><TableHead>Cliente</TableHead><TableHead>Endereço</TableHead><TableHead>Cidade</TableHead><TableHead>Recebimento</TableHead><TableHead>Agendamento</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {!list.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Nenhum endereço cadastrado.</TableCell></TableRow>}
            {list.map((a) => (
              <TableRow key={a.id} className={cn(!a.active && "opacity-50")}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                <TableCell>{clients.find((c) => c.id === a.client_id)?.name ?? "—"}</TableCell>
                <TableCell>{a.street ?? "—"}</TableCell>
                <TableCell>{a.city}/{a.uf}</TableCell>
                <TableCell>{a.receive_from || a.receive_to ? `${a.receive_from?.slice(0, 5) ?? "?"} às ${a.receive_to?.slice(0, 5) ?? "?"}` : "—"}</TableCell>
                <TableCell>{a.needs_booking ? "Exige" : "—"}</TableCell>
                <TableCell>{a.active ? "Ativo" : "Inativo"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar endereço" : "Novo endereço"}</DialogTitle><DialogDescription>Local de carga ou descarga.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label htmlFor="la-name">Nome do local</Label><Input id="la-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Pátio AB5, Suzano Portaria 2" /></div>
            <div className="col-span-2 space-y-1"><Label className="block">Cliente</Label>
              <SearchSelect value={f.client_id} onChange={(v) => setF({ ...f, client_id: v })} searchPlaceholder="Digite o cliente" options={[{ value: "__none__", label: "—" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} /></div>
            <div className="col-span-2 space-y-1"><Label htmlFor="la-street">Endereço</Label><Input id="la-street" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} placeholder="Rua, número, bairro" /></div>
            <div className="space-y-1"><Label htmlFor="la-city">Cidade</Label><Input id="la-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="la-uf">UF</Label><Input id="la-uf" maxLength={2} value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1"><Label htmlFor="la-from">Recebe a partir de</Label><Input id="la-from" type="time" value={f.receive_from} onChange={(e) => setF({ ...f, receive_from: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="la-to">Recebe até</Label><Input id="la-to" type="time" value={f.receive_to} onChange={(e) => setF({ ...f, receive_to: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label htmlFor="la-notes">Observações</Label><Input id="la-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ex.: portaria pede crachá de integração" /></div>
            <div className="flex items-center gap-2"><Switch id="la-b" checked={f.needs_booking} onCheckedChange={(v) => setF({ ...f, needs_booking: v })} /><Label htmlFor="la-b">Exige agendamento</Label></div>
            <div className="flex items-center gap-2"><Switch id="la-a" checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /><Label htmlFor="la-a">Ativo</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={save.isPending || !f.name.trim() || !f.city.trim()} onClick={() => save.mutate({ id: edit?.id, row: {
              name: f.name.trim(), client_id: f.client_id === "__none__" ? null : f.client_id, street: f.street.trim() || null, city: f.city.trim(), uf: f.uf.trim() || "SP",
              receive_from: f.receive_from || null, receive_to: f.receive_to || null, needs_booking: f.needs_booking, notes: f.notes.trim() || null, active: f.active,
            } }, { onSuccess: () => setEdit(null) })}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CNH = ["B", "C", "D", "E"];
function VehiclesTab() {
  const { base } = useLogData();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Vehicle | null>(null);
  const [f, setF] = useState({ cargo_capacity_kg: "", bed_length_m: "", cargo_volume_m3: "", cnh_category: "__none__", has_crane: false });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("vehicles").update({ cargo_capacity_kg: num(f.cargo_capacity_kg), bed_length_m: num(f.bed_length_m), cargo_volume_m3: num(f.cargo_volume_m3), cnh_category: f.cnh_category === "__none__" ? null : f.cnh_category, has_crane: f.has_crane }).eq("id", edit!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Veículo salvo"); qc.invalidateQueries({ queryKey: LOG_KEY }); setEdit(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const list = (base.data?.vehicles ?? []).filter((v) => v.status !== "inactive");
  const rules = base.data?.rules ?? [];
  const WD = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Carga útil, carroceria e categoria de CNH de cada veículo (mesmo cadastro da Transporte). Sem carga útil o veículo não entra na sugestão.</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader><TableRow><TableHead>Veículo</TableHead><TableHead>Ações</TableHead><TableHead>Placa</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Carga útil</TableHead><TableHead className="text-right">Carroceria (m)</TableHead><TableHead className="text-right">Volume (m³)</TableHead><TableHead>CNH</TableHead><TableHead>Munck</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => { setEdit(v); setF({ cargo_capacity_kg: s(v.cargo_capacity_kg), bed_length_m: s(v.bed_length_m), cargo_volume_m3: s(v.cargo_volume_m3), cnh_category: v.cnh_category ?? "__none__", has_crane: !!v.has_crane }); }}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                <TableCell>{v.plate}</TableCell>
                <TableCell>{v.type ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.cargo_capacity_kg ? kg(Number(v.cargo_capacity_kg)) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.bed_length_m ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.cargo_volume_m3 ?? "—"}</TableCell>
                <TableCell>{v.cnh_category ?? "—"}</TableCell>
                <TableCell>{v.has_crane ? "Sim" : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <section className="space-y-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Restrições de circulação</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Cidade</TableHead><TableHead>Dia</TableHead><TableHead>Finais de placa</TableHead><TableHead>Horários</TableHead></TableRow></TableHeader>
            <TableBody>{rules.map((r, i) => <TableRow key={i}><TableCell>{r.city}</TableCell><TableCell>{WD[r.weekday]}</TableCell><TableCell>{r.plate_endings.replace(",", " e ")}</TableCell><TableCell>{r.windows.split(",").map((w) => w.replace("-", " às ")).join(" e ")}</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{edit?.plate}</DialogTitle><DialogDescription>Dados de carga do veículo.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="lv-cap">Carga útil (kg)</Label><Input id="lv-cap" inputMode="decimal" value={f.cargo_capacity_kg} onChange={(e) => setF({ ...f, cargo_capacity_kg: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lv-bed">Carroceria (m)</Label><Input id="lv-bed" inputMode="decimal" value={f.bed_length_m} onChange={(e) => setF({ ...f, bed_length_m: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lv-vol">Volume (m³)</Label><Input id="lv-vol" inputMode="decimal" value={f.cargo_volume_m3} onChange={(e) => setF({ ...f, cargo_volume_m3: e.target.value })} /></div>
            <div className="space-y-1"><Label className="block">CNH exigida</Label>
              <Select value={f.cnh_category} onValueChange={(v) => setF({ ...f, cnh_category: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">—</SelectItem>{CNH.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div className="col-span-2 flex items-center gap-2"><Switch id="lv-crane" checked={f.has_crane} onCheckedChange={(v) => setF({ ...f, has_crane: v })} /><Label htmlFor="lv-crane">Tem munck</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Settings2, Trash2, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAll } from "@/lib/results-engine";
import { normalizePlate } from "@/lib/fleet-costs";
import { closestPlate, isoDay, maintenanceState, type MaintenanceState } from "@/lib/fleet-notes";
import type { Tables } from "@/integrations/supabase/types";

type Vehicle = { id: string; plate: string; model: string | null; ownership: string; status: string | null };
type Plan = Tables<"vehicle_maintenance_plans">;
type Rec = Tables<"vehicle_maintenance_records">;
type Row = Vehicle & { plan: Plan | null; records: Rec[]; km: number | null; kmDate: string | null; state: MaintenanceState };
type StatusFilter = "all" | MaintenanceState["status"];

const km = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString("pt-BR")} km`);
const brDate = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const toNum = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const STATUS: Record<MaintenanceState["status"], { label: string; cls: string }> = {
  vencida: { label: "Vencida", cls: "bg-destructive text-destructive-foreground hover:bg-destructive" },
  perto: { label: "Perto", cls: "bg-amber-500 text-white hover:bg-amber-500" },
  "em-dia": { label: "Em dia", cls: "bg-emerald-600 text-white hover:bg-emerald-600" },
  "sem-regra": { label: "Sem regra", cls: "bg-muted text-muted-foreground hover:bg-muted" },
};
const ORDER = { vencida: 0, perto: 1, "em-dia": 2, "sem-regra": 3 } as const;

/** Frota › Manutenção: regra de revisão por veículo e km atual pela última nota do posto. */
export function FleetServicePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ownership, setOwnership] = useState("all");
  const [planFor, setPlanFor] = useState<Row | null>(null);
  const [recordFor, setRecordFor] = useState<Row | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const vehicles = useQuery({ queryKey: ["fleet-maint-vehicles"], queryFn: async () => ((await supabase.from("vehicles").select("id, plate, model, ownership, status").order("plate")).data ?? []) as Vehicle[] });
  const plans = useQuery({ queryKey: ["fleet-maint-plans"], queryFn: async () => (await supabase.from("vehicle_maintenance_plans").select("*")).data ?? [] });
  const records = useQuery({ queryKey: ["fleet-maint-records"], queryFn: () => fetchAll<Rec>((a, b) => supabase.from("vehicle_maintenance_records").select("*").order("service_date", { ascending: false }).range(a, b)) });
  const readings = useQuery({
    queryKey: ["fleet-maint-km"],
    queryFn: () => fetchAll<any>((a, b) => supabase.from("fleet_fuel_notes").select("plate, plate_fix, km, km_fix, issued_at")
      .gte("issued_at", new Date(Date.now() - 400 * 86_400_000).toISOString()).order("issued_at", { ascending: false }).range(a, b)),
  });

  const rows = useMemo<Row[]>(() => {
    const lastKm = new Map<string, { km: number; date: string | null }>();
    const allPlates = (vehicles.data ?? []).map((v) => v.plate);
    for (const r of readings.data ?? []) {
      // Placa da nota → placa cadastrada mais próxima (ECM8414 = ECM8E14), como no Abastecimento.
      const p = r.plate_fix ? normalizePlate(r.plate_fix) : closestPlate(r.plate, allPlates);
      const k = r.km_fix ?? r.km;
      if (p && k != null && !lastKm.has(p)) lastKm.set(p, { km: Number(k), date: isoDay(r.issued_at) });
    }
    return (vehicles.data ?? []).filter((v) => v.status !== "inactive").map((v) => {
      const plan = (plans.data ?? []).find((p) => p.vehicle_id === v.id) ?? null;
      const recs = (records.data ?? []).filter((r) => r.vehicle_id === v.id);
      const prev = recs.find((r) => r.kind === "preventiva");
      const reading = lastKm.get(normalizePlate(v.plate));
      const state = maintenanceState(plan, prev ? { km: prev.km, date: prev.service_date } : null, reading?.km ?? null, today);
      return { ...v, plan, records: recs, km: reading?.km ?? null, kmDate: reading?.date ?? null, state };
    }).sort((a, b) => ORDER[a.state.status] - ORDER[b.state.status] || a.plate.localeCompare(b.plate));
  }, [vehicles.data, plans.data, records.data, readings.data, today]);

  const shown = rows.filter((r) => (status === "all" || r.state.status === status) && (ownership === "all" || r.ownership === ownership));
  const count = (s: MaintenanceState["status"]) => rows.filter((r) => r.state.status === s).length;
  const history = rows.find((r) => r.id === historyFor) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manutenção"
        description="Cada veículo tem a sua regra de revisão preventiva: a cada X km e/ou a cada Y meses (nos alugados, o km pedido pela locadora). O km atual vem da última nota do posto (Frota › Abastecimento). Fica 'Perto' quando faltam 10% do km ou 30 dias."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Situação</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="vencida">Vencidas</SelectItem>
              <SelectItem value="perto">Perto de vencer</SelectItem>
              <SelectItem value="em-dia">Em dia</SelectItem>
              <SelectItem value="sem-regra">Sem regra</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={ownership} onValueChange={setOwnership}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="proprio">Próprios</SelectItem>
              <SelectItem value="alugado">Alugados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["vencida", "perto", "em-dia", "sem-regra"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? "all" : s)} className={`panel p-3 text-left ${status === s ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{STATUS[s].label}</div>
            <div className={`text-lg font-semibold tabular-nums ${s === "vencida" && count(s) ? "text-destructive" : ""}`}>{count(s)}</div>
          </button>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placa</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Regra</TableHead>
              <TableHead>Última preventiva</TableHead>
              <TableHead>Km atual</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : !shown.length ? (
              <TableRow><TableCell colSpan={9} className="text-muted-foreground">Nenhum veículo nesta situação.</TableCell></TableRow>
            ) : shown.map((r) => {
              const s = r.state;
              const rule = [r.plan?.interval_km ? `${r.plan.interval_km.toLocaleString("pt-BR")} km` : null, r.plan?.interval_months ? `${r.plan.interval_months} meses` : null].filter(Boolean).join(" ou ");
              const left = [s.kmLeft != null ? (s.kmLeft <= 0 ? `passou ${Math.abs(s.kmLeft).toLocaleString("pt-BR")} km` : `faltam ${s.kmLeft.toLocaleString("pt-BR")} km`) : null,
                s.daysLeft != null ? (s.daysLeft <= 0 ? `venceu há ${Math.abs(s.daysLeft)} dias` : `faltam ${s.daysLeft} dias`) : null].filter(Boolean).join(" · ");
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.plate}</TableCell>
                  <TableCell>{r.model ?? "—"}</TableCell>
                  <TableCell>{r.ownership === "alugado" ? "Alugado" : "Próprio"}</TableCell>
                  <TableCell>{rule || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{s.lastKm != null || s.lastDate ? `${km(s.lastKm)} · ${brDate(s.lastDate)}` : "—"}</TableCell>
                  <TableCell>{km(r.km)}{r.kmDate && <span className="block text-xs text-muted-foreground">nota de {brDate(r.kmDate)}</span>}</TableCell>
                  <TableCell>{[s.nextKm != null ? km(s.nextKm) : null, s.nextDate ? brDate(s.nextDate) : null].filter(Boolean).join(" ou ") || "—"}{left && <span className="block text-xs text-muted-foreground">{left}</span>}</TableCell>
                  <TableCell><Badge className={STATUS[s.status].cls}>{STATUS[s.status].label}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" title="Regra de revisão" onClick={() => setPlanFor(r)}><Settings2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" title="Registrar revisão" onClick={() => setRecordFor(r)}><Wrench className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" title="Histórico" onClick={() => setHistoryFor(r.id)}><History className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PlanDialog row={planFor} onClose={() => setPlanFor(null)} />
      <RecordDialog row={recordFor} onClose={() => setRecordFor(null)} />
      <HistoryDialog row={history} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function PlanDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ km: "", months: "", baseKm: "", baseDate: "", notes: "" });
  useEffect(() => {
    if (!row) return;
    const p = row.plan;
    setF({
      km: p?.interval_km != null ? String(p.interval_km) : row.ownership === "alugado" ? "" : "10000",
      months: p?.interval_months != null ? String(p.interval_months) : row.ownership === "alugado" ? "" : "6",
      baseKm: p?.base_km != null ? String(p.base_km) : "", baseDate: p?.base_date ?? "", notes: p?.notes ?? "",
    });
  }, [row?.id]);
  const save = useMutation({
    mutationFn: async () => {
      const vals = { interval_km: toNum(f.km), interval_months: toNum(f.months), base_km: toNum(f.baseKm) };
      if (Object.values(vals).some((v) => Number.isNaN(v))) throw new Error("Use só números.");
      const { error } = await supabase.from("vehicle_maintenance_plans").upsert({
        vehicle_id: row!.id, interval_km: vals.interval_km == null ? null : Math.round(vals.interval_km), interval_months: vals.interval_months == null ? null : Math.round(vals.interval_months),
        base_km: vals.base_km, base_date: f.baseDate || null, notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Regra salva."); qc.invalidateQueries({ queryKey: ["fleet-maint-plans"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Regra de revisão · {row.plate}</DialogTitle>
          <DialogDescription>{row.ownership === "alugado" ? "Alugado: informe o km de revisão pedido pela locadora." : "Próprio: revisão preventiva por km e/ou por tempo, o que vencer primeiro."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="pl-km">A cada (km)</Label><Input id="pl-km" inputMode="numeric" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pl-m">A cada (meses)</Label><Input id="pl-m" inputMode="numeric" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pl-bkm">Km da última revisão</Label><Input id="pl-bkm" inputMode="numeric" value={f.baseKm} onChange={(e) => setF({ ...f, baseKm: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pl-bd">Data da última revisão</Label><Input id="pl-bd" type="date" value={f.baseDate} onChange={(e) => setF({ ...f, baseDate: e.target.value })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Km e data da última revisão só valem até a primeira revisão registrada no sistema.</p>
        <div className="space-y-1"><Label htmlFor="pl-n">Observações</Label><Textarea id="pl-n" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ date: "", km: "", kind: "preventiva", description: "", cost: "" });
  useEffect(() => { if (row) setF({ date: new Date().toISOString().slice(0, 10), km: row.km != null ? String(Math.round(row.km)) : "", kind: "preventiva", description: "", cost: "" }); }, [row?.id]);
  const save = useMutation({
    mutationFn: async () => {
      const kmVal = toNum(f.km), cost = toNum(f.cost);
      if (Number.isNaN(kmVal) || Number.isNaN(cost)) throw new Error("Use só números no km e no valor.");
      if (!f.date) throw new Error("Informe a data.");
      const { error } = await supabase.from("vehicle_maintenance_records").insert({ vehicle_id: row!.id, service_date: f.date, km: kmVal, kind: f.kind, description: f.description.trim() || null, cost });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Revisão registrada."); qc.invalidateQueries({ queryKey: ["fleet-maint-records"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar revisão · {row.plate}</DialogTitle>
          <DialogDescription>A preventiva zera a contagem da próxima revisão. A corretiva fica só no histórico.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="rc-d">Data</Label><Input id="rc-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="rc-km">Km</Label><Input id="rc-km" inputMode="numeric" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="preventiva">Preventiva</SelectItem><SelectItem value="corretiva">Corretiva</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="rc-c">Valor (R$)</Label><Input id="rc-c" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="rc-desc">O que foi feito</Label><Textarea id="rc-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("vehicle_maintenance_records").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Registro excluído."); qc.invalidateQueries({ queryKey: ["fleet-maint-records"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico · {row.plate}</DialogTitle>
          <DialogDescription>{row.records.length} registro(s).</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Km</TableHead><TableHead>Tipo</TableHead><TableHead>O que foi feito</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {!row.records.length ? (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhuma revisão registrada.</TableCell></TableRow>
              ) : row.records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{brDate(r.service_date)}</TableCell>
                  <TableCell>{km(r.km)}</TableCell>
                  <TableCell>{r.kind === "preventiva" ? "Preventiva" : "Corretiva"}</TableCell>
                  <TableCell className="whitespace-pre-wrap">{r.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.cost == null ? "—" : Number(r.cost).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

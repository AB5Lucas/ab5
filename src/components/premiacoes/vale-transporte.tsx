import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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


type Rule = Tables<"transport_voucher_rules">;

const CALC_LABEL: Record<string, string> = {
  daily: "Por dia programado",
  round_trip: "Por ida e volta (2x por dia)",
  fixed_monthly: "Valor fixo mensal",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = () => {
  const d = new Date();
  if (d.getDate() >= 26) d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type FormState = {
  name: string;
  calculation_type: string;
  amount: string;
  applies_to_drivers: boolean;
  applies_to_collaborators: boolean;
  active: boolean;
};

const emptyForm: FormState = {
  name: "",
  calculation_type: "daily",
  amount: "0",
  applies_to_drivers: true,
  applies_to_collaborators: true,
  active: true,
};

export function VoucherPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [month, setMonth] = useState(monthKey());

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const rules = useQuery({
    queryKey: ["vt-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_voucher_rules")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        calculation_type: form.calculation_type,
        amount: Number(form.amount.replace(",", ".")) || 0,
        applies_to_drivers: form.applies_to_drivers,
        applies_to_collaborators: form.applies_to_collaborators,
        active: form.active,
      };
      if (!payload.name) throw new Error("Informe o nome da regra");
      if (editing) {
        const { error } = await supabase.from("transport_voucher_rules").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("transport_voucher_rules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Regra atualizada" : "Regra criada");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["vt-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transport_voucher_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra excluída");
      queryClient.invalidateQueries({ queryKey: ["vt-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const calc = useQuery({
    queryKey: ["vt-calc", month],
    queryFn: async () => {
      // Período de fechamento: dia 26 do mês anterior até 25 do mês selecionado
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7));
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const start = fmt(new Date(y, m - 2, 26));
      const end = fmt(new Date(y, m - 1, 26));

      const { data: schedules, error: se } = await supabase
        .from("daily_schedules")
        .select("id, schedule_date")
        .gte("schedule_date", start)
        .lt("schedule_date", end);
      if (se) throw se;
      const ids = (schedules ?? []).map((s) => s.id);
      const dateById = new Map((schedules ?? []).map((s) => [s.id, s.schedule_date]));

      type AllocRow = {
        collaborator_id: string;
        schedule_id: string;
        work_id: string;
        driver: boolean;
        vt_override: boolean | null;
        collaborators: unknown;
      };
      const allocations: AllocRow[] = [];
      if (ids.length) {
        for (let from = 0; ; from += 1000) {
          const { data, error: ae } = await supabase
            .from("daily_allocations")
            .select(
              "collaborator_id, schedule_id, work_id, driver, vt_override, collaborators(full_name, registration_number, city, vt_enabled)",
            )
            .in("schedule_id", ids)
            .order("id")
            .range(from, from + 999);
          if (ae) throw ae;
          allocations.push(...((data ?? []) as AllocRow[]));
          if (!data || data.length < 1000) break;
        }
      }

      // Sem VT para quem está em falta, atestado, médico ou interjornada no dia.
      const noVt = new Set<string>();
      if (ids.length) {
        const [st, ml] = await Promise.all([
          supabase
            .from("daily_status_entries")
            .select("schedule_id, collaborator_id")
            .in("schedule_id", ids)
            .in("box_key", ["falta", "atestado", "medico", "interjornada", "licenca", "abono"]),
          supabase
            .from("medical_leaves")
            .select("collaborator_id, start_date, end_date")
            .lt("start_date", end)
            .gte("end_date", start),
        ]);
        for (const r of st.data ?? []) noVt.add(`${r.schedule_id}|${r.collaborator_id}`);
        for (const [sid, d] of dateById) {
          for (const l of ml.data ?? []) if (l.start_date <= d && l.end_date >= d) noVt.add(`${sid}|${l.collaborator_id}`);
        }
      }
      for (let i = allocations.length - 1; i >= 0; i--) {
        const a = allocations[i]!;
        if (noVt.has(`${a.schedule_id}|${a.collaborator_id}`)) allocations.splice(i, 1);
      }

      const vtMap = new Map<string, boolean>();
      if (ids.length) {
        const { data: vts, error: ve } = await supabase
          .from("schedule_work_vt")
          .select("schedule_id, work_id, pays_vt")
          .in("schedule_id", ids);
        if (ve) throw ve;
        for (const v of vts ?? []) vtMap.set(`${v.schedule_id}|${v.work_id}`, v.pays_vt);
      }

      // Quadros de ASO / Treinamento / Integração
      const { data: appts, error: pe } = await supabase
        .from("appointments")
        .select(
          "type, collaborator_id, scheduled_date, pays_transport_voucher, clients(name), collaborators(full_name, registration_number)",
        )
        .in("type", ["aso", "treinamento", "integracao"])
        .neq("status", "cancelado")
        .gte("scheduled_date", start)
        .lt("scheduled_date", end);
      if (pe) throw pe;

      const boxVt = new Map<string, boolean>();
      const personVt = new Map<string, boolean>();
      type Entry = { schedule_id: string; box_key: string; collaborator_id: string; collaborators: unknown };
      let entries: Entry[] = [];
      if (ids.length) {
        const [b, p, e] = await Promise.all([
          supabase.from("schedule_box_vt").select("schedule_id, box_key, pays_vt").in("schedule_id", ids),
          supabase.from("schedule_person_vt").select("schedule_id, box_key, collaborator_id, pays_vt").in("schedule_id", ids),
          supabase
            .from("daily_status_entries")
            .select("schedule_id, box_key, collaborator_id, collaborators(full_name, registration_number)")
            .in("schedule_id", ids)
            .or("box_key.eq.aso,box_key.eq.treinamento,box_key.like.integracao%"),
        ]);
        if (b.error) throw b.error;
        if (p.error) throw p.error;
        if (e.error) throw e.error;
        for (const r of b.data ?? []) boxVt.set(`${r.schedule_id}|${r.box_key}`, r.pays_vt);
        for (const r of p.data ?? []) personVt.set(`${r.schedule_id}|${r.box_key}|${r.collaborator_id}`, r.pays_vt);
        entries = (e.data ?? []) as Entry[];
      }
      const scheduleByDate = new Map((schedules ?? []).map((s) => [s.schedule_date, s.id]));
      const boxDefault = (k: string) => k === "aso" || k === "treinamento";

      type C = { full_name: string; registration_number: string } | null;
      const map = new Map<string, { name: string; reg: string; units: Map<string, number>; driver: boolean }>();
      const entryFor = (key: string, c: C) => {
        const entry = map.get(key) ?? {
          name: c?.full_name ?? "—",
          reg: c?.registration_number ?? "",
          units: new Map<string, number>(),
          driver: false,
        };
        map.set(key, entry);
        return entry;
      };
      const add = (collab: string, c: C, dayKey: string, n: number) => {
        if (n <= 0) return;
        const e = entryFor(collab, c);
        e.units.set(dayKey, (e.units.get(dayKey) ?? 0) + n);
      };
      for (const a of allocations) {
        const c = (a as unknown as { collaborators: C }).collaborators;
        // Regra: status de VT da obra no dia; exceção individual do colaborador prevalece.
        const cc = (a as unknown as { collaborators: { city?: string | null; vt_enabled?: boolean | null } | null }).collaborators;
        const city = (cc?.city ?? "").toLowerCase();
        const pouso = city.includes("pouso alegre");
        const base = cc?.vt_enabled === false ? false : (vtMap.get(`${a.schedule_id}|${a.work_id}`) || pouso);
        const pays = a.vt_override ?? base;
        if (!pays) continue;
        const date = dateById.get(a.schedule_id) ?? a.schedule_id;
        const e = entryFor(a.collaborator_id, c);
        if (!e.units.has(date)) e.units.set(date, 1); // uma obra por dia
        if (a.driver) e.driver = true;
      }
      // Membros dos quadros (sem duplicar pessoa no mesmo quadro/dia)
      const seen = new Set<string>();
      const boxMember = (date: string, box: string, collab: string, c: C, apptVt: boolean) => {
        const sid = scheduleByDate.get(date) ?? null;
        const k = `${date}|${box}|${collab}`;
        if (seen.has(k)) return;
        seen.add(k);
        const override = sid ? personVt.get(`${sid}|${box}|${collab}`) : undefined;
        const boxOn = (sid ? boxVt.get(`${sid}|${box}`) : undefined) ?? boxDefault(box);
        const on = override ?? (apptVt ? true : boxOn);
        const base = box === "aso" ? 1 : 0; // ASO sempre tem 1 VT
        add(collab, c, date, base + (on ? 1 : 0));
      };
      for (const p of appts ?? []) {
        const row = p as unknown as { clients: { name: string } | null; collaborators: C };
        const box = p.type === "integracao" ? `integracao:${row.clients?.name ?? "—"}` : p.type;
        boxMember(p.scheduled_date, box, p.collaborator_id, row.collaborators, p.type === "integracao" && p.pays_transport_voucher);
      }
      for (const e of entries) {
        const date = dateById.get(e.schedule_id);
        if (!date) continue;
        boxMember(date, e.box_key, e.collaborator_id, (e.collaborators as C) ?? null, false);
      }
      return [...map.values()]
        .map((e) => ({
          name: e.name,
          reg: e.reg,
          days: [...e.units.values()].reduce((s, n) => s + n, 0),
          driver: e.driver,
        }))
        .filter((e) => e.days > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const activeRules = useMemo(() => (rules.data ?? []).filter((r) => r.active), [rules.data]);

  const amountFor = (driver: boolean, days: number) =>
    activeRules.reduce((sum, r) => {
      if (driver && !r.applies_to_drivers) return sum;
      if (!driver && !r.applies_to_collaborators) return sum;
      const amount = Number(r.amount);
      if (r.calculation_type === "fixed_monthly") return sum + (days > 0 ? amount : 0);
      if (r.calculation_type === "round_trip") return sum + amount * 2 * days;
      return sum + amount * days;
    }, 0);

  const total = (calc.data ?? []).reduce((s, r) => s + amountFor(r.driver, r.days), 0);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(r: Rule) {
    setEditing(r);
    setForm({
      name: r.name,
      calculation_type: r.calculation_type,
      amount: String(r.amount),
      applies_to_drivers: r.applies_to_drivers,
      applies_to_collaborators: r.applies_to_collaborators,
      active: r.active,
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vale-Transporte"
        description='Apuração mensal dos colaboradores escalados em obras com VT ligado na programação diária.'
        actions={
          canWrite ? (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Nova regra
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="calculo">
        <TabsList>
          <TabsTrigger value="calculo">Cálculo mensal</TabsTrigger>
          <TabsTrigger value="regras">Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="calculo" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="mes">Mês de referência</Label>
              <Input id="mes" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="panel px-4 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total do mês</p>
              <p className="font-display text-xl font-semibold">{money(total)}</p>
            </div>
          </div>

          {activeRules.length === 0 && (
            <p className="text-sm text-warning">
              Nenhuma regra ativa cadastrada — os valores permanecem zerados até configurar as regras.
            </p>
          )}

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>VTs no período</TableHead>
                  <TableHead>Motorista</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>Carregando...</TableCell>
                  </TableRow>
                )}
                {!calc.isLoading && (calc.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Nenhuma programação encontrada neste mês.
                    </TableCell>
                  </TableRow>
                )}
                {(calc.data ?? []).map((r) => (
                  <TableRow key={`${r.name}-${r.reg}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.reg}</TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell>{r.driver ? <Badge variant="secondary">Sim</Badge> : "—"}</TableCell>
                    <TableCell className="text-right">{money(amountFor(r.driver, r.days))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="regras">
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regra</TableHead>
                  <TableHead>Cálculo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Aplica a</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Nenhuma regra cadastrada.
                    </TableCell>
                  </TableRow>
                )}
                {(rules.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{CALC_LABEL[r.calculation_type] ?? r.calculation_type}</TableCell>
                    <TableCell>{money(Number(r.amount))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[r.applies_to_collaborators && "Colaboradores", r.applies_to_drivers && "Motoristas"]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Ativa" : "Inativa"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar regra" : "Nova regra de vale-transporte"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Tipo de cálculo</Label>
                <Select value={form.calculation_type} onValueChange={(v) => set("calculation_type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CALC_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="valor">Valor (R$)</Label>
                <Input id="valor" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="colab">Aplica a colaboradores</Label>
              <Switch
                id="colab"
                checked={form.applies_to_collaborators}
                onCheckedChange={(v) => set("applies_to_collaborators", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="mot">Aplica a motoristas</Label>
              <Switch
                id="mot"
                checked={form.applies_to_drivers}
                onCheckedChange={(v) => set("applies_to_drivers", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ativo">Regra ativa</Label>
              <Switch id="ativo" checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

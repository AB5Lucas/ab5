import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/beneficios/premio-motorista")({
  head: () => ({
    meta: [
      { title: "Prêmio de Motorista | Programação Operacional" },
      { name: "description", content: "Regras por faixa de distância e apuração mensal do prêmio de motorista." },
      { property: "og:title", content: "Prêmio de Motorista | Programação Operacional" },
      { property: "og:description", content: "Faixas de distância, pedágio e apuração mensal do prêmio de motorista." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverBonusPage,
});

type Rule = Tables<"driver_bonus_rules">;

const CALC_LABEL: Record<string, string> = {
  daily: "Por dia programado na faixa",
  fixed_monthly: "Valor fixo mensal",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kmFmt = (v: number) => `${v.toLocaleString("pt-BR")} km`;
const monthKey = () => new Date().toISOString().slice(0, 7);
const num = (v: string) => Number(v.replace(",", ".")) || 0;

type FormState = {
  name: string;
  calculation_type: string;
  amount: string;
  minimum_distance: string;
  maximum_distance: string;
  active: boolean;
};

const emptyForm: FormState = {
  name: "",
  calculation_type: "daily",
  amount: "0",
  minimum_distance: "0",
  maximum_distance: "",
  active: true,
};

function DriverBonusPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [month, setMonth] = useState(monthKey());

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const rules = useQuery({
    queryKey: ["db-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_bonus_rules").select("*").order("minimum_distance");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const min = num(form.minimum_distance);
      const max = form.maximum_distance.trim() === "" ? null : num(form.maximum_distance);
      if (max !== null && max <= min) throw new Error("A distância máxima deve ser maior que a mínima");
      const payload = {
        name: form.name.trim(),
        calculation_type: form.calculation_type,
        amount: num(form.amount),
        minimum_distance: min,
        maximum_distance: max,
        active: form.active,
      };
      if (!payload.name) throw new Error("Informe o nome da regra");
      const { error } = editing
        ? await supabase.from("driver_bonus_rules").update(payload).eq("id", editing.id)
        : await supabase.from("driver_bonus_rules").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Regra atualizada" : "Regra criada");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["db-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("driver_bonus_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra excluída");
      queryClient.invalidateQueries({ queryKey: ["db-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const calc = useQuery({
    queryKey: ["driver-bonus-calc", month],
    queryFn: async () => {
      const start = `${month}-01`;
      const endDate = new Date(`${month}-01T00:00:00`);
      endDate.setMonth(endDate.getMonth() + 1);
      const end = endDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("vehicle_schedules")
        .select(
          "driver_id, schedule_date, is_external, driver_bonus, km, collaborators(full_name, registration_number), clients(has_toll, toll_amount, trips_per_day)",
        )
        .gte("schedule_date", start)
        .lt("schedule_date", end)
        .eq("driver_bonus", true)
        .eq("is_external", false);
      if (error) throw error;

      type Entry = { name: string; reg: string; days: Map<string, { km: number; toll: number }> };
      const map = new Map<string, Entry>();
      for (const r of data ?? []) {
        const row = r as unknown as {
          driver_id: string | null;
          schedule_date: string;
          km: number | null;
          collaborators: { full_name: string; registration_number: string } | null;
          clients: { has_toll: boolean | null; toll_amount: number | null; trips_per_day: number | null } | null;
        };
        if (!row.driver_id) continue;
        const entry =
          map.get(row.driver_id) ?? {
            name: row.collaborators?.full_name ?? "—",
            reg: row.collaborators?.registration_number ?? "",
            days: new Map<string, { km: number; toll: number }>(),
          };
        const trips = Math.max(1, Number(row.clients?.trips_per_day ?? 1) || 1);
        // O pedágio cadastrado é de ida: ida e volta em cada viagem do dia.
        const toll = row.clients?.has_toll ? (Number(row.clients.toll_amount ?? 0) || 0) * 2 * trips : 0;
        const prev = entry.days.get(row.schedule_date) ?? { km: 0, toll: 0 };
        entry.days.set(row.schedule_date, {
          km: prev.km + (Number(row.km ?? 0) || 0),
          toll: prev.toll + toll,
        });
        map.set(row.driver_id, entry);
      }
      return [...map.values()]
        .map((e) => ({
          name: e.name,
          reg: e.reg,
          days: [...e.days.values()],
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });

  const activeRules = useMemo(() => (rules.data ?? []).filter((r) => r.active), [rules.data]);

  const rulesFor = (distance: number) =>
    activeRules.filter((r) => {
      const min = Number(r.minimum_distance ?? 0);
      const max = r.maximum_distance === null ? Infinity : Number(r.maximum_distance);
      return distance >= min && distance <= max;
    });

  // O prêmio é pago uma vez por dia programado, conforme a faixa de distância do dia.
  const amountFor = (days: { km: number; toll: number }[]) => {
    let total = 0;
    const fixedApplied = new Set<string>();
    for (const day of days) {
      for (const rule of rulesFor(day.km)) {
        const value = Number(rule.amount);
        if (rule.calculation_type === "fixed_monthly") {
          if (!fixedApplied.has(rule.id)) {
            fixedApplied.add(rule.id);
            total += value;
          }
        } else {
          total += value;
        }
      }
    }
    return total;
  };

  const rows = useMemo(
    () =>
      (calc.data ?? []).map((r) => {
        const km = r.days.reduce((s, d) => s + d.km, 0);
        const toll = r.days.reduce((s, d) => s + d.toll, 0);
        return { name: r.name, reg: r.reg, count: r.days.length, km, toll, amount: amountFor(r.days) };
      }),
    [calc.data, activeRules],
  );

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const totalToll = rows.reduce((s, r) => s + r.toll, 0);

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
      minimum_distance: String(r.minimum_distance ?? 0),
      maximum_distance: r.maximum_distance === null ? "" : String(r.maximum_distance),
      active: r.active,
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prêmio de Motorista"
        description="Faixas por distância do dia (ida e volta) apuradas pelas programações da frota com o prêmio ativado. Programações externas nunca geram prêmio."
        actions={canWrite ? (<Button onClick={openNew}><Plus className="h-4 w-4" /> Nova faixa</Button>) : null}
      />

      <Tabs defaultValue="calculo">
        <TabsList>
          <TabsTrigger value="calculo">Cálculo mensal</TabsTrigger>
          <TabsTrigger value="regras">Faixas de distância</TabsTrigger>
        </TabsList>

        <TabsContent value="calculo" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="mes-pm">Mês de referência</Label>
              <Input id="mes-pm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="panel px-4 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total de prêmios</p>
              <p className="font-display text-xl font-semibold">{money(total)}</p>
            </div>
            <div className="panel px-4 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total de pedágio</p>
              <p className="font-display text-xl font-semibold">{money(totalToll)}</p>
            </div>
          </div>

          {activeRules.length === 0 && (
            <p className="text-sm text-warning">
              Nenhuma faixa ativa cadastrada — os valores permanecem zerados até configurar as faixas.
            </p>
          )}

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Dias com prêmio</TableHead>
                  <TableHead className="text-right">KM no mês</TableHead>
                  <TableHead className="text-right">Pedágio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.isLoading && (<TableRow><TableCell colSpan={6}>Carregando...</TableCell></TableRow>)}
                {!calc.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Nenhuma programação com prêmio de motorista neste mês.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={`${r.name}-${r.reg}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.reg}</TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell className="text-right">{kmFmt(r.km)}</TableCell>
                    <TableCell className="text-right">{money(r.toll)}</TableCell>
                    <TableCell className="text-right">{money(r.amount)}</TableCell>
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
                  <TableHead>Faixa (km ida e volta)</TableHead>
                  <TableHead>Cálculo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">Nenhuma faixa cadastrada.</TableCell>
                  </TableRow>
                )}
                {(rules.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      {Number(r.minimum_distance ?? 0).toLocaleString("pt-BR")} —{" "}
                      {r.maximum_distance === null ? "acima" : Number(r.maximum_distance).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{CALC_LABEL[r.calculation_type] ?? r.calculation_type}</TableCell>
                    <TableCell>{money(Number(r.amount))}</TableCell>
                    <TableCell>
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Ativa" : "Inativa"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
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
            <DialogTitle>{editing ? "Editar faixa" : "Nova faixa do prêmio de motorista"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="nome-pm">Nome da situação</Label>
              <Input id="nome-pm" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="min-pm">Distância mínima (km)</Label>
                <Input id="min-pm" value={form.minimum_distance} onChange={(e) => set("minimum_distance", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="max-pm">Distância máxima (km)</Label>
                <Input
                  id="max-pm"
                  placeholder="deixe vazio para sem limite"
                  value={form.maximum_distance}
                  onChange={(e) => set("maximum_distance", e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              As faixas usam a distância rodada no dia (ida e volta, já multiplicada pelas viagens do cliente).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Tipo de cálculo</Label>
                <Select value={form.calculation_type} onValueChange={(v) => set("calculation_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CALC_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="valor-pm">Valor (R$)</Label>
                <Input id="valor-pm" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ativa-pm">Faixa ativa</Label>
              <Switch id="ativa-pm" checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

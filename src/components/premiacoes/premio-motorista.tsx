import { loadDriverBonus, periodOf } from "@/lib/closing";
import { invalidateDriverBonus } from "@/lib/invalidate-driver-bonus";
import { CountUp } from "@/components/count-up";
import { useMemo, useState } from "react";
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


type Rule = Tables<"driver_bonus_rules">;

const CALC_LABEL: Record<string, string> = {
  daily: "Por dia programado na faixa",
  fixed_monthly: "Valor fixo mensal",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kmFmt = (v: number) => `${v.toLocaleString("pt-BR")} km`;
const monthKey = () => {
  const d = new Date();
  if (d.getDate() >= 26) d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
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

export function DriverBonusPage() {
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
    onSuccess: async () => {
      toast.success(editing ? "Regra atualizada" : "Regra criada");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await invalidateDriverBonus(queryClient);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("driver_bonus_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Regra excluída");
      await invalidateDriverBonus(queryClient);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Mesma regra paga no Fechamento (lib/closing.ts loadDriverBonus → lib/driver-bonus.ts): por motorista e dia, soma do
  // km de ida dos fretes que ele dirigiu (principal e extras), sem ausências, transporte montado ou botão da linha.
  const calc = useQuery({
    queryKey: ["driver-bonus-calc-v3", month],
    queryFn: async () => {
      const { start, end } = periodOf(month);
      const { days, info } = await loadDriverBonus(start, end);
      const by = new Map<string, { name: string; reg: string; count: number; km: number; toll: number; amount: number }>();
      for (const d of days) {
        const c = info.get(d.driverId);
        const e = by.get(d.driverId) ?? { name: c?.full_name ?? "—", reg: c?.registration_number ?? "", count: 0, km: 0, toll: 0, amount: 0 };
        e.count++; e.km += d.km; e.toll += d.toll; e.amount += d.amount;
        by.set(d.driverId, e);
      }
      return [...by.values()].sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
    },
  });

  const activeRules = useMemo(() => (rules.data ?? []).filter((r) => r.active), [rules.data]);
  const rows = calc.data ?? [];

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
        description="Um prêmio por motorista por dia: a faixa é a soma do km de ida dos fretes que ele dirigiu no dia (principal e obras adicionais), nas programações com o prêmio ativado ou com transporte montado. Externo, Indústria com local e Manutenção/Revisão não geram prêmio. É o mesmo valor do Fechamento."
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
              <p className="font-display text-xl font-semibold"><CountUp value={money(total)} /></p>
            </div>
            <div className="panel px-4 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total de pedágio</p>
              <p className="font-display text-xl font-semibold"><CountUp value={money(totalToll)} /></p>
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
                  <TableHead className="text-right">KM de ida no mês</TableHead>
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
                  <TableHead>Faixa (km de ida no dia)</TableHead>
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
            <DialogTitle>{editing ? "Editar faixa" : "Nova faixa do prêmio de motorista"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="nome-pm">Nome da situação</Label>
              <Input id="nome-pm" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="min-pm">Km de ida no dia — mínimo</Label>
                <Input id="min-pm" value={form.minimum_distance} onChange={(e) => set("minimum_distance", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="max-pm">Km de ida no dia — máximo</Label>
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

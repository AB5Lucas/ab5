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
      { name: "description", content: "Regras configuráveis e apuração mensal do prêmio de motorista pela programação de veículos." },
      { property: "og:title", content: "Prêmio de Motorista | Programação Operacional" },
      { property: "og:description", content: "Apuração mensal do prêmio de motorista a partir da programação da frota." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverBonusPage,
});

type Rule = Tables<"driver_bonus_rules">;

const CALC_LABEL: Record<string, string> = {
  daily: "Por dia programado com prêmio",
  fixed_monthly: "Valor fixo mensal",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = () => new Date().toISOString().slice(0, 7);

type FormState = { name: string; calculation_type: string; amount: string; active: boolean };
const emptyForm: FormState = { name: "", calculation_type: "daily", amount: "0", active: true };

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
      const { data, error } = await supabase.from("driver_bonus_rules").select("*").order("created_at");
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
        .select("driver_id, schedule_date, is_external, driver_bonus, collaborators(full_name, registration_number)")
        .gte("schedule_date", start)
        .lt("schedule_date", end)
        .eq("driver_bonus", true)
        .eq("is_external", false);
      if (error) throw error;

      const map = new Map<string, { name: string; reg: string; days: Set<string> }>();
      for (const r of data ?? []) {
        const row = r as unknown as {
          driver_id: string | null;
          schedule_date: string;
          collaborators: { full_name: string; registration_number: string } | null;
        };
        if (!row.driver_id) continue;
        const entry = map.get(row.driver_id) ?? {
          name: row.collaborators?.full_name ?? "—",
          reg: row.collaborators?.registration_number ?? "",
          days: new Set<string>(),
        };
        entry.days.add(row.schedule_date);
        map.set(row.driver_id, entry);
      }
      return [...map.values()]
        .map((e) => ({ name: e.name, reg: e.reg, days: e.days.size }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });

  const activeRules = useMemo(() => (rules.data ?? []).filter((r) => r.active), [rules.data]);

  const amountFor = (days: number) =>
    activeRules.reduce((sum, r) => {
      const amount = Number(r.amount);
      if (r.calculation_type === "fixed_monthly") return sum + (days > 0 ? amount : 0);
      return sum + amount * days;
    }, 0);

  const total = (calc.data ?? []).reduce((s, r) => s + amountFor(r.days), 0);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(r: Rule) {
    setEditing(r);
    setForm({ name: r.name, calculation_type: r.calculation_type, amount: String(r.amount), active: r.active });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prêmio de Motorista"
        description="Apurado pelas programações da frota com o prêmio ativado. Programações externas nunca geram prêmio."
        actions={canWrite ? (<Button onClick={openNew}><Plus className="h-4 w-4" /> Nova regra</Button>) : null}
      />

      <Tabs defaultValue="calculo">
        <TabsList>
          <TabsTrigger value="calculo">Cálculo mensal</TabsTrigger>
          <TabsTrigger value="regras">Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="calculo" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="mes-pm">Mês de referência</Label>
              <Input id="mes-pm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
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
                  <TableHead>Motorista</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Dias com prêmio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.isLoading && (<TableRow><TableCell colSpan={4}>Carregando...</TableCell></TableRow>)}
                {!calc.isLoading && (calc.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      Nenhuma programação com prêmio de motorista neste mês.
                    </TableCell>
                  </TableRow>
                )}
                {(calc.data ?? []).map((r) => (
                  <TableRow key={`${r.name}-${r.reg}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.reg}</TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell className="text-right">{money(amountFor(r.days))}</TableCell>
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
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">Nenhuma regra cadastrada.</TableCell>
                  </TableRow>
                )}
                {(rules.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
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
            <DialogTitle>{editing ? "Editar regra" : "Nova regra de prêmio de motorista"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="nome-pm">Nome</Label>
              <Input id="nome-pm" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
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
              <Label htmlFor="ativa-pm">Regra ativa</Label>
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

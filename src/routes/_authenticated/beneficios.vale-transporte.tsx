import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/beneficios/vale-transporte")({
  head: () => ({
    meta: [
      { title: "Vale-Transporte | Programação Operacional" },
      {
        name: "description",
        content: "Regras configuráveis de vale-transporte e cálculo mensal por colaborador programado.",
      },
      { property: "og:title", content: "Vale-Transporte | Programação Operacional" },
      { property: "og:description", content: "Regras de vale-transporte e apuração mensal automática." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoucherPage,
});

type Rule = Tables<"transport_voucher_rules">;

const CALC_LABEL: Record<string, string> = {
  daily: "Por dia programado",
  round_trip: "Por ida e volta (2x por dia)",
  fixed_monthly: "Valor fixo mensal",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = () => new Date().toISOString().slice(0, 7);

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

function VoucherPage() {
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
      const start = `${month}-01`;
      const endDate = new Date(`${month}-01T00:00:00`);
      endDate.setMonth(endDate.getMonth() + 1);
      const end = endDate.toISOString().slice(0, 10);

      const { data: schedules, error: se } = await supabase
        .from("daily_schedules")
        .select("id, schedule_date")
        .gte("schedule_date", start)
        .lt("schedule_date", end);
      if (se) throw se;
      const ids = (schedules ?? []).map((s) => s.id);
      if (ids.length === 0) return [] as { name: string; reg: string; days: number; driver: boolean }[];

      const { data: allocations, error: ae } = await supabase
        .from("daily_allocations")
        .select("collaborator_id, schedule_id, driver, collaborators(full_name, registration_number)")
        .in("schedule_id", ids);
      if (ae) throw ae;

      const map = new Map<string, { name: string; reg: string; days: Set<string>; driver: boolean }>();
      for (const a of allocations ?? []) {
        const c = (a as unknown as { collaborators: { full_name: string; registration_number: string } | null })
          .collaborators;
        const key = a.collaborator_id;
        const entry = map.get(key) ?? {
          name: c?.full_name ?? "—",
          reg: c?.registration_number ?? "",
          days: new Set<string>(),
          driver: false,
        };
        entry.days.add(a.schedule_id);
        if (a.driver) entry.driver = true;
        map.set(key, entry);
      }
      return [...map.values()]
        .map((e) => ({ name: e.name, reg: e.reg, days: e.days.size, driver: e.driver }))
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
        description="Regras configuráveis e apuração mensal com base nos dias programados."
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
                  <TableHead>Dias programados</TableHead>
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

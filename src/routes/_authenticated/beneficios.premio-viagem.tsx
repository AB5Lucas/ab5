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
import type { Tables, Enums } from "@/integrations/supabase/types";
import { buildDistanceLookup } from "@/lib/city-distance";

export const Route = createFileRoute("/_authenticated/beneficios/premio-viagem")({
  head: () => ({
    meta: [
      { title: "Prêmio de Viagem | Programação Operacional" },
      {
        name: "description",
        content: "Regras por faixa de distância e apuração mensal automática do prêmio de viagem.",
      },
      { property: "og:title", content: "Prêmio de Viagem | Programação Operacional" },
      { property: "og:description", content: "Faixas de distância, valores e cálculo mensal por colaborador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BonusPage,
});

type Rule = Tables<"travel_bonus_rules">;
type CalcType = Enums<"bonus_calculation_type">;

const CALC_LABEL: Record<CalcType, string> = {
  daily: "Por dia programado",
  trip: "Por viagem (ida)",
  round_trip: "Por ida e volta (2x)",
  overnight: "Por pernoite (dorme fora)",
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = () => {
  const d = new Date();
  if (d.getDate() >= 26) d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type FormState = {
  minimum_distance: string;
  maximum_distance: string;
  bonus_amount: string;
  calculation_type: CalcType;
  active: boolean;
};

const emptyForm: FormState = {
  minimum_distance: "0",
  maximum_distance: "",
  bonus_amount: "0",
  calculation_type: "daily",
  active: true,
};

const num = (v: string) => Number(v.replace(",", ".")) || 0;

type Row = { name: string; reg: string; days: number; distance: number; amount: number };

function BonusPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [month, setMonth] = useState(monthKey());

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const rules = useQuery({
    queryKey: ["tb-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_bonus_rules")
        .select("*")
        .order("minimum_distance");
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
        minimum_distance: min,
        maximum_distance: max,
        bonus_amount: num(form.bonus_amount),
        calculation_type: form.calculation_type,
        active: form.active,
      };
      if (editing) {
        const { error } = await supabase.from("travel_bonus_rules").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("travel_bonus_rules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Faixa atualizada" : "Faixa criada");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["tb-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("travel_bonus_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Faixa excluída");
      queryClient.invalidateQueries({ queryKey: ["tb-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeRules = useMemo(() => (rules.data ?? []).filter((r) => r.active), [rules.data]);

  const rulesFor = (distance: number) =>
    activeRules.filter((r) => {
      const min = Number(r.minimum_distance);
      const max = r.maximum_distance === null ? Infinity : Number(r.maximum_distance);
      return distance >= min && distance <= max;
    });

  const allocations = useQuery({
    queryKey: ["tb-allocations", month],
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
        .select("id")
        .gte("schedule_date", start)
        .lt("schedule_date", end);
      if (se) throw se;
      const ids = (schedules ?? []).map((s) => s.id);
      if (ids.length === 0)
        return [] as {
          collaborator_id: string;
          schedule_id: string;
          name: string;
          reg: string;
          distance: number;
        }[];

      const data: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase
          .from("daily_allocations")
          .select(
            "collaborator_id, schedule_id, work_id, travel_bonus_override, collaborators(full_name, registration_number, city, travel_bonus_enabled), works(city, distance_km, clients(city, distance_km))",
          )
          .in("schedule_id", ids)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        data.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      const { data: cityDist } = await supabase.from("city_distances").select("city_a, city_b, km");
      const distFor = buildDistanceLookup(cityDist ?? []);
      const { data: trW } = await supabase.from("schedule_work_travel").select("schedule_id, work_id, pays_bonus").in("schedule_id", ids);
      const travelWork = new Map((trW ?? []).map((v) => [`${v.schedule_id}|${v.work_id}`, v.pays_bonus]));

      return (data ?? []).filter((a: any) =>
        a.travel_bonus_override ?? ((travelWork.get(`${a.schedule_id}|${a.work_id}`) ?? rulesFor(Number(a.works?.clients?.distance_km ?? a.works?.distance_km ?? 0)).length > 0)),
      ).map((a) => {
        const row = a as unknown as {
          collaborator_id: string;
          schedule_id: string;
          collaborators: { full_name: string; registration_number: string; city: string | null } | null;
          works: { city: string | null; distance_km: number | null; clients: { city: string | null; distance_km: number | null } | null } | null;
        };
        return {
          collaborator_id: row.collaborator_id,
          schedule_id: row.schedule_id,
          name: row.collaborators?.full_name ?? "—",
          reg: row.collaborators?.registration_number ?? "",
          distance: distFor(
            row.collaborators?.city,
            row.works?.clients?.city ?? row.works?.city,
            Number(row.works?.clients?.distance_km ?? row.works?.distance_km ?? 0),
          ),
        };
      });
    },
  });

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, { name: string; reg: string; days: Set<string>; distance: number; amount: number }>();
    for (const a of allocations.data ?? []) {
      const entry =
        map.get(a.collaborator_id) ?? { name: a.name, reg: a.reg, days: new Set<string>(), distance: 0, amount: 0 };
      entry.days.add(a.schedule_id);
      entry.distance = Math.max(entry.distance, a.distance);
      for (const rule of rulesFor(a.distance)) {
        const value = Number(rule.bonus_amount);
        entry.amount += rule.calculation_type === "round_trip" ? value * 2 : value;
      }
      map.set(a.collaborator_id, entry);
    }
    return [...map.values()]
      .map((e) => ({ name: e.name, reg: e.reg, days: e.days.size, distance: e.distance, amount: e.amount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allocations.data, activeRules]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(r: Rule) {
    setEditing(r);
    setForm({
      minimum_distance: String(r.minimum_distance),
      maximum_distance: r.maximum_distance === null ? "" : String(r.maximum_distance),
      bonus_amount: String(r.bonus_amount),
      calculation_type: r.calculation_type,
      active: r.active,
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prêmio de Viagem"
        description="Faixas por distância da obra e apuração mensal automática a partir das alocações."
        actions={
          canWrite ? (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Nova faixa
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="calculo">
        <TabsList>
          <TabsTrigger value="calculo">Cálculo mensal</TabsTrigger>
          <TabsTrigger value="faixas">Faixas de distância</TabsTrigger>
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
              Nenhuma faixa ativa cadastrada — os valores permanecem zerados até configurar as faixas.
            </p>
          )}

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Dias programados</TableHead>
                  <TableHead>Maior distância (km)</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>Carregando...</TableCell>
                  </TableRow>
                )}
                {!allocations.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Nenhuma programação encontrada neste mês.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={`${r.name}-${r.reg}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.reg}</TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell>{r.distance ? r.distance.toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-right">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="faixas">
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Faixa (km)</TableHead>
                  <TableHead>Cálculo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Nenhuma faixa cadastrada.
                    </TableCell>
                  </TableRow>
                )}
                {(rules.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {Number(r.minimum_distance).toLocaleString("pt-BR")} —{" "}
                      {r.maximum_distance === null
                        ? "acima"
                        : Number(r.maximum_distance).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{CALC_LABEL[r.calculation_type]}</TableCell>
                    <TableCell>{money(Number(r.bonus_amount))}</TableCell>
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
            <DialogTitle>{editing ? "Editar faixa" : "Nova faixa de distância"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="min">Distância mínima (km)</Label>
                <Input
                  id="min"
                  value={form.minimum_distance}
                  onChange={(e) => set("minimum_distance", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="max">Distância máxima (km)</Label>
                <Input
                  id="max"
                  placeholder="deixe vazio para sem limite"
                  value={form.maximum_distance}
                  onChange={(e) => set("maximum_distance", e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Tipo de cálculo</Label>
                <Select
                  value={form.calculation_type}
                  onValueChange={(v) => set("calculation_type", v as CalcType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CALC_LABEL) as CalcType[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {CALC_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="valor">Valor do prêmio (R$)</Label>
                <Input id="valor" value={form.bonus_amount} onChange={(e) => set("bonus_amount", e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ativa">Faixa ativa</Label>
              <Switch id="ativa" checked={form.active} onCheckedChange={(v) => set("active", v)} />
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

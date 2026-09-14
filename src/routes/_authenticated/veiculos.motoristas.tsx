import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/veiculos/motoristas")({
  head: () => ({
    meta: [
      { title: "Motoristas | Programação Operacional" },
      { name: "description", content: "Colaboradores habilitados, categoria e validade da CNH com alerta de vencimento." },
      { property: "og:title", content: "Motoristas | Programação Operacional" },
      { property: "og:description", content: "Controle de CNH dos motoristas da operação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriversPage,
});

type CnhStatus = "valid" | "expiring" | "expired" | "unknown";

const STATUS: Record<CnhStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  valid: { label: "Válida", variant: "default" },
  expiring: { label: "A vencer", variant: "outline" },
  expired: { label: "Vencida", variant: "destructive" },
  unknown: { label: "Sem data", variant: "secondary" },
};

function cnhStatus(expiry: string | null): CnhStatus {
  if (!expiry) return "unknown";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${expiry}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

function DriversPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | CnhStatus>("all");

  const drivers = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, social_name, registration_number, phone, status, driver_license_category, driver_license_expiry")
        .eq("is_driver", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  const schedule = useQuery({
    queryKey: ["driver-today", today],
    queryFn: async () => {
      const { data: sched } = await supabase
        .from("daily_schedules")
        .select("id")
        .eq("schedule_date", today)
        .maybeSingle();
      if (!sched) return {} as Record<string, string>;
      const [{ data: transports }, { data: works }] = await Promise.all([
        supabase.from("transport_allocations").select("driver_id, work_id").eq("schedule_id", sched.id),
        supabase.from("works").select("id, name"),
      ]);
      const workName = new Map((works ?? []).map((w) => [w.id, w.name]));
      const map: Record<string, string> = {};
      (transports ?? []).forEach((t) => {
        if (t.driver_id) map[t.driver_id] = workName.get(t.work_id) ?? "Obra";
      });
      return map;
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (drivers.data ?? [])
      .map((d) => ({ ...d, cnh: cnhStatus(d.driver_license_expiry) }))
      .filter((d) => {
        if (filter !== "all" && d.cnh !== filter) return false;
        if (!q) return true;
        return [d.full_name, d.social_name, d.registration_number, d.driver_license_category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
  }, [drivers.data, search, filter]);

  const counts = useMemo(() => {
    const list = (drivers.data ?? []).map((d) => cnhStatus(d.driver_license_expiry));
    return {
      total: list.length,
      expired: list.filter((s) => s === "expired").length,
      expiring: list.filter((s) => s === "expiring").length,
    };
  }, [drivers.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Motoristas"
        description="Colaboradores habilitados, categoria e validade da CNH. Edite os dados no cadastro de colaboradores."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Motoristas</p>
          <p className="font-display text-2xl font-semibold">{counts.total}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">CNH a vencer (30 dias)</p>
          <p className="font-display text-2xl font-semibold">{counts.expiring}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">CNH vencida</p>
          <p className="font-display text-2xl font-semibold text-destructive">{counts.expired}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar motorista"
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as CNHs</SelectItem>
            <SelectItem value="valid">Válidas</SelectItem>
            <SelectItem value="expiring">A vencer</SelectItem>
            <SelectItem value="expired">Vencidas</SelectItem>
            <SelectItem value="unknown">Sem data</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matrícula</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>CNH</TableHead>
              <TableHead>Hoje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Carregando motoristas...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhum motorista encontrado.</TableCell></TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.registration_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{d.social_name || d.full_name}</div>
                    {d.status !== "active" && <span className="text-xs text-muted-foreground">Inativo</span>}
                  </TableCell>
                  <TableCell>{d.driver_license_category || "—"}</TableCell>
                  <TableCell>
                    {d.driver_license_expiry
                      ? new Date(`${d.driver_license_expiry}T00:00:00`).toLocaleDateString("pt-BR")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[d.cnh].variant}>{STATUS[d.cnh].label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {schedule.data?.[d.id] ?? "Sem transporte"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

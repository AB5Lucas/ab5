import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Users,
  CalendarCheck,
  CalendarOff,
  Stethoscope,
  Coffee,
  Truck,
  ClipboardCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard Operacional | Programação" },
      {
        name: "description",
        content: "Visão geral diária de obras ativas, colaboradores programados, ausências e frota.",
      },
      { property: "og:title", content: "Dashboard Operacional | Programação" },
      { property: "og:description", content: "Indicadores diários da programação operacional." },
    ],
  }),
  component: DashboardPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function useDashboard() {
  return useQuery({
    queryKey: ["dashboard", today()],
    queryFn: async () => {
      const d = today();
      const count = async (fn: () => PromiseLike<{ count: number | null }>) => (await fn()).count ?? 0;

      const [works, collaborators, vehiclesAvailable, vacations, leaves, off] = await Promise.all([
        count(() => supabase.from("works").select("id", { count: "exact", head: true }).eq("status", "active")),
        count(() => supabase.from("collaborators").select("id", { count: "exact", head: true }).eq("status", "active")),
        count(() => supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "available")),
        count(() => supabase.from("vacations").select("id", { count: "exact", head: true }).lte("start_date", d).gte("end_date", d)),
        count(() => supabase.from("medical_leaves").select("id", { count: "exact", head: true }).lte("start_date", d).gte("end_date", d)),
        count(() => supabase.from("days_off").select("id", { count: "exact", head: true }).eq("date", d)),
      ]);

      const { data: schedule } = await supabase
        .from("daily_schedules")
        .select("id, status")
        .eq("schedule_date", d)
        .maybeSingle();

      let scheduled = 0;
      let confirmed = 0;
      if (schedule) {
        scheduled = await count(() =>
          supabase.from("daily_allocations").select("id", { count: "exact", head: true }).eq("schedule_id", schedule.id),
        );
        confirmed = await count(() =>
          supabase
            .from("daily_allocations")
            .select("id", { count: "exact", head: true })
            .eq("schedule_id", schedule.id)
            .eq("confirmation_status", "confirmed"),
        );
      }

      return {
        works,
        collaborators,
        vehiclesAvailable,
        vacations,
        leaves,
        off,
        scheduled,
        confirmed,
        pending: scheduled - confirmed,
        scheduleStatus: schedule?.status ?? null,
      };
    },
  });
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-primary";
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-md bg-secondary ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="font-display text-2xl font-semibold leading-none">{value}</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const d = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
        actions={
          <Button asChild>
            <Link to="/programacao/hoje">Abrir programação de hoje</Link>
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando indicadores...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Obras ativas" value={d?.works ?? 0} icon={Building2} />
          <Stat label="Colaboradores ativos" value={d?.collaborators ?? 0} icon={Users} />
          <Stat label="Programados hoje" value={d?.scheduled ?? 0} icon={CalendarCheck} />
          <Stat label="Confirmados" value={d?.confirmed ?? 0} icon={ClipboardCheck} tone="success" />
          <Stat label="Pendentes de confirmação" value={d?.pending ?? 0} icon={ClipboardCheck} tone="warning" />
          <Stat label="Férias hoje" value={d?.vacations ?? 0} icon={CalendarOff} tone="warning" />
          <Stat label="Atestados hoje" value={d?.leaves ?? 0} icon={Stethoscope} tone="destructive" />
          <Stat label="Folgas hoje" value={d?.off ?? 0} icon={Coffee} />
          <Stat label="Veículos disponíveis" value={d?.vehiclesAvailable ?? 0} icon={Truck} />
        </div>
      )}

      <div className="panel p-5">
        <h2 className="font-display text-lg uppercase tracking-wide">Próximos passos</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A Fase 1 está concluída: banco de dados real, autenticação, perfis de acesso (Administrador,
          Programador e Consulta) com RLS, layout e menu. As próximas fases habilitam os cadastros de
          colaboradores e obras, treinamentos e ausências, e então a tela de programação diária com
          drag and drop.
        </p>
      </div>
    </div>
  );
}

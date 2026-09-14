import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { addDays, formatBR, todayISO } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/programacao/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de Programação | Programação Operacional" },
      { name: "description", content: "Consulta somente leitura das programações passadas por período e obra." },
      { property: "og:title", content: "Histórico de Programação | Programação Operacional" },
      { property: "og:description", content: "Consulta somente leitura das programações passadas por período e obra." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  in_progress: "Em andamento",
  finalized: "Finalizada",
};

function Page() {
  const [from, setFrom] = useState(() => addDays(todayISO(), -30));
  const [to, setTo] = useState(() => todayISO());
  const [open, setOpen] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["history", from, to],
    queryFn: async () => {
      const { data: schedules } = await supabase
        .from("daily_schedules")
        .select("id, schedule_date, status, finalized_at")
        .gte("schedule_date", from)
        .lte("schedule_date", to)
        .order("schedule_date", { ascending: false });

      const ids = (schedules ?? []).map((s) => s.id);
      const { data: allocs } = ids.length
        ? await supabase
            .from("daily_allocations")
            .select("schedule_id, work_id, collaborator_id, confirmation_status, has_pending_requirement")
            .in("schedule_id", ids)
        : { data: [] as never[] };

      const [{ data: works }, { data: collaborators }] = await Promise.all([
        supabase.from("works").select("id, code, name"),
        supabase.from("collaborators").select("id, full_name, registration_number"),
      ]);

      return {
        schedules: schedules ?? [],
        allocations: allocs ?? [],
        works: works ?? [],
        collaborators: collaborators ?? [],
      };
    },
  });

  const data = list.data;
  const workById = new Map((data?.works ?? []).map((w) => [w.id, w]));
  const collabById = new Map((data?.collaborators ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Histórico de Programação"
        description="Consulta somente leitura das programações já realizadas."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
          </div>
        }
      />

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando histórico…</p>
      ) : !(data?.schedules ?? []).length ? (
        <div className="panel p-8 text-center text-sm text-muted-foreground">
          Nenhuma programação encontrada no período selecionado.
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.schedules ?? []).map((s) => {
            const allocs = (data?.allocations ?? []).filter((a) => a.schedule_id === s.id);
            const byWork = new Map<string, typeof allocs>();
            allocs.forEach((a) => {
              const arr = byWork.get(a.work_id) ?? [];
              arr.push(a);
              byWork.set(a.work_id, arr);
            });
            const isOpen = open === s.id;
            return (
              <div key={s.id} className="panel p-4">
                <button
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  onClick={() => setOpen(isOpen ? null : s.id)}
                >
                  <div>
                    <p className="font-display text-sm font-semibold uppercase">{formatBR(s.schedule_date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {allocs.length} alocações · {byWork.size} obras ·{" "}
                      {allocs.filter((a) => a.confirmation_status === "confirmed").length} confirmadas
                    </p>
                  </div>
                  <Badge variant={s.status === "finalized" ? "default" : "secondary"}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </button>

                {isOpen && (
                  <div className="mt-4 space-y-3 border-t border-border pt-3">
                    {[...byWork.entries()].map(([workId, items]) => {
                      const w = workById.get(workId);
                      return (
                        <div key={workId}>
                          <p className="text-sm font-semibold">
                            <span className="font-mono text-xs text-muted-foreground">{w?.code}</span> {w?.name ?? "Obra"}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {items.map((a, i) => {
                              const c = collabById.get(a.collaborator_id);
                              return (
                                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                                  <span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {c?.registration_number}
                                    </span>{" "}
                                    {c?.full_name ?? "—"}
                                  </span>
                                  <span className="flex gap-1">
                                    {a.has_pending_requirement && (
                                      <Badge variant="destructive">Pendência</Badge>
                                    )}
                                    <Badge
                                      variant={a.confirmation_status === "confirmed" ? "default" : "outline"}
                                    >
                                      {a.confirmation_status === "confirmed" ? "Confirmado" : "Pendente"}
                                    </Badge>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                    {!byWork.size && <p className="text-sm text-muted-foreground">Sem alocações neste dia.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

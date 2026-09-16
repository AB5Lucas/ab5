import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { SchedulePlannerBoard } from "@/components/schedule-planner-board";
import { todayISO } from "@/lib/scheduling";

const searchSchema = z.object({
  date: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/programacao/diaria")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Programação Diária | Programação Operacional" },
      { name: "description", content: "Monte a programação de qualquer data com equipes base, cópia do dia anterior e validação de requisitos." },
      { property: "og:title", content: "Programação Diária | Programação Operacional" },
      { property: "og:description", content: "Monte a programação de qualquer data com validação de disponibilidade e requisitos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DailySchedulePage,
});

function DailySchedulePage() {
  const { date } = Route.useSearch();
  const navigate = useNavigate({ from: "/programacao/diaria" });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Programação Diária"
        description="Arraste os colaboradores da lista lateral para os cards de obra. O sistema valida disponibilidade, conflitos e requisitos."
      />
      <SchedulePlannerBoard
        date={valid}
        onDateChange={(d) => navigate({ search: { date: d } })}
      />
    </div>
  );
}

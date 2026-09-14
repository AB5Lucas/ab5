import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { DailyScheduleBoard } from "@/components/daily-schedule-board";
import { todayISO } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/programacao/diaria")({
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
  const [date, setDate] = useState(todayISO());

  return (
    <div className="space-y-4">
      <PageHeader
        title="Programação Diária"
        description="Monte a programação de qualquer data: gere pelas equipes base, copie o dia anterior e confirme as alocações."
      />
      <DailyScheduleBoard date={date} onDateChange={setDate} />
    </div>
  );
}

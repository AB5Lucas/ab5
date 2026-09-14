import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { DailyScheduleBoard } from "@/components/daily-schedule-board";
import { formatBR, todayISO } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/programacao/hoje")({
  head: () => ({
    meta: [
      { title: "Programação de Hoje | Programação Operacional" },
      { name: "description", content: "Acompanhe e confirme a programação do dia por obra, com pendências e indisponibilidades." },
      { property: "og:title", content: "Programação de Hoje | Programação Operacional" },
      { property: "og:description", content: "Acompanhe e confirme a programação do dia por obra em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TodayPage,
});

function TodayPage() {
  const date = todayISO();
  return (
    <div className="space-y-4">
      <PageHeader title="Programação de Hoje" description={formatBR(date)} />
      <DailyScheduleBoard date={date} />
    </div>
  );
}

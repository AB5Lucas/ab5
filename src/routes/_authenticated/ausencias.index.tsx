import { createFileRoute } from "@tanstack/react-router";
import { AbsenceManager } from "@/components/absence-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AbsTab = "folgas" | "atestados" | "ferias";

export const Route = createFileRoute("/_authenticated/ausencias/")({
  head: () => ({
    meta: [
      { title: "Ausências | AB5 Hub" },
      { name: "description", content: "Folgas, atestados e férias dos colaboradores." },
      { property: "og:title", content: "Ausências | AB5 Hub" },
      { property: "og:description", content: "Folgas, atestados e férias dos colaboradores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: AbsTab } =>
    s["tab"] === "atestados" || s["tab"] === "ferias" ? { tab: s["tab"] } : {},
  component: AbsencesPage,
});

function AbsencesPage() {
  const { tab = "folgas" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Tabs value={tab} onValueChange={(v) => navigate({ search: v === "folgas" ? {} : { tab: v as AbsTab }, replace: true })}>
      <TabsList>
        <TabsTrigger value="folgas">Folgas</TabsTrigger>
        <TabsTrigger value="atestados">Atestados</TabsTrigger>
        <TabsTrigger value="ferias">Férias</TabsTrigger>
      </TabsList>
      <TabsContent value="folgas" className="mt-4">
        <AbsenceManager table="days_off" mode="single" title="Folgas" description="Folgas pontuais concedidas aos colaboradores por data." extraFieldLabel="Motivo" extraFieldName="reason" addLabel="Lançar folga" />
      </TabsContent>
      <TabsContent value="atestados" className="mt-4">
        <AbsenceManager table="medical_leaves" mode="period" title="Atestados" description="Atestados médicos e períodos de afastamento dos colaboradores." extraFieldLabel="Link do documento" extraFieldName="document_url" addLabel="Lançar atestado" />
      </TabsContent>
      <TabsContent value="ferias" className="mt-4">
        <AbsenceManager table="vacations" mode="period" title="Férias" description="Períodos de férias programados e em curso por colaborador." addLabel="Lançar férias" />
      </TabsContent>
    </Tabs>
  );
}

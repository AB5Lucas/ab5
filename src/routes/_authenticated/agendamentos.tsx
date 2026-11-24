import { createFileRoute } from "@tanstack/react-router";
import { Tabs as SubTabs, TabsContent as SubTabsContent, TabsList as SubTabsList, TabsTrigger as SubTabsTrigger } from "@/components/ui/tabs";
import { IntegrationsPage } from "@/components/controles/integracoes";
import { TrainingsPage } from "@/components/controles/treinamentos";
import { AsosPage } from "@/components/controles/asos";
import { EpiSheetsPage } from "@/components/controles/fichas-epi";
import { NewClientDocsPage } from "@/components/controles/novos-clientes";
import { ClientReleasePage } from "@/components/controles/liberacao-cliente";
import { useControlBadges } from "@/hooks/use-nav-badges";

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({
    meta: [
      { title: "Controles | AB5 Hub" },
      {
        name: "description",
        content:
          "Controle de pendências de ASO, treinamentos e integrações: confirme a realização ou reagende para uma nova data.",
      },
      { property: "og:title", content: "Controles | AB5 Hub" },
      {
        property: "og:description",
        content: "Lista de pendências de ASO, treinamento e integração com confirmação e reagendamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: CtrlTab } =>
    CTRL_TABS.some((t) => t.v === s["tab"]) ? { tab: s["tab"] as CtrlTab } : {},
  component: ControlsPage,
});

const CTRL_TABS = [
  { v: "asos", l: "ASOs" },
  { v: "integracoes", l: "Integrações" },
  { v: "treinamentos", l: "Treinamentos" },
  { v: "novos-clientes", l: "Novos Clientes" },
  { v: "liberacao", l: "Liberação por cliente" },
  { v: "epi", l: "Fichas de EPI" },
] as const;
type CtrlTab = (typeof CTRL_TABS)[number]["v"];

function ControlsPage() {
  const { tab = "asos" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const badges = useControlBadges();
  return (
    <SubTabs pageTabs value={tab} onValueChange={(v) => navigate({ search: v === "asos" ? {} : { tab: v as CtrlTab }, replace: true })}>
      <SubTabsList>
        {CTRL_TABS.map((t) => {
          const b = (badges as Partial<Record<CtrlTab, { tone: string; count: number }>>)[t.v];
          return (
            <SubTabsTrigger key={t.v} value={t.v} className="gap-1.5">
              {t.l}
              {b && (
                <span className={`min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}>
                  {b.count > 99 ? "99+" : b.count}
                </span>
              )}
            </SubTabsTrigger>
          );
        })}
      </SubTabsList>
      <SubTabsContent value="asos" className="mt-4"><AsosPage /></SubTabsContent>
      <SubTabsContent value="integracoes" className="mt-4"><IntegrationsPage /></SubTabsContent>
      <SubTabsContent value="treinamentos" className="mt-4"><TrainingsPage /></SubTabsContent>
      <SubTabsContent value="novos-clientes" className="mt-4"><NewClientDocsPage /></SubTabsContent>
      <SubTabsContent value="liberacao" className="mt-4"><ClientReleasePage /></SubTabsContent>
      <SubTabsContent value="epi" className="mt-4"><EpiSheetsPage /></SubTabsContent>
    </SubTabs>
  );
}


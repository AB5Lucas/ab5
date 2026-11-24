import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { VehicleTimeline } from "@/components/vehicle-timeline";
import { VehicleHandover } from "@/components/vehicle-handover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VehiclesPage } from "@/components/veiculos/frota";
import { DriversPage } from "@/components/veiculos/motoristas";

export const Route = createFileRoute("/_authenticated/veiculos/transporte")({
  head: () => ({
    meta: [
      { title: "Transporte | AB5 Hub" },
      { name: "description", content: "Planejamento de transporte por obra: veículo, motorista, passageiros e horários de saída e retorno." },
      { property: "og:title", content: "Transporte | AB5 Hub" },
      { property: "og:description", content: "Veículo, motorista, passageiros e horários por obra." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    TABS.some((t) => t.v === s["tab"]) ? { tab: s["tab"] as Tab } : {},
  component: TransportTabs,
});

const TABS = [
  { v: "transporte", l: "Transporte" },
  { v: "frota", l: "Frota" },
  { v: "motoristas", l: "Motoristas" },
] as const;
type Tab = (typeof TABS)[number]["v"];

function TransportTabs() {
  const { tab = "transporte" } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Volta para a mesma altura em que o usuário deixou a página.
  useEffect(() => {
    const key = "transporte-scroll";
    const target = Number(localStorage.getItem(key) ?? 0);
    let tries = 0, ready = target === 0;
    const restore = () => {
      if (ready) return;
      if (document.documentElement.scrollHeight - window.innerHeight >= target || tries > 40) {
        window.scrollTo(0, target); ready = true; return;
      }
      tries++; setTimeout(restore, 100);
    };
    restore();
    const onScroll = () => { if (ready && window.location.pathname.startsWith("/veiculos/transporte") && document.documentElement.scrollHeight > window.innerHeight + 50) localStorage.setItem(key, String(Math.round(window.scrollY))); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <Tabs pageTabs value={tab} onValueChange={(v) => navigate({ search: v === "transporte" ? {} : { tab: v as Tab }, replace: true, resetScroll: false })}>
      <TabsList>
        {TABS.map((t) => <TabsTrigger key={t.v} value={t.v}>{t.l}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="transporte" className="mt-4"><TransportPage /></TabsContent>
      <TabsContent value="frota" className="mt-4"><VehiclesPage /></TabsContent>
      <TabsContent value="motoristas" className="mt-4"><DriversPage /></TabsContent>
    </Tabs>
  );
}

function TransportPage() {
  // Transporte diário inativado: a página mostra apenas a timeline mensal.
  return (
    <div className="space-y-4">
      <PageHeader
        title="Transporte"
        description="Programação mensal da frota: motorista, obra/cliente, prêmio de motorista e quilometragem automática."
        actions={<VehicleHandover />}
      />
      <VehicleTimeline />
    </div>
  );
}

import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Users,
  Building2,
  Truck,
  CalendarOff,
  Wallet,
  FileBarChart,
  Shield,
  ClipboardList,
  Boxes,
} from "lucide-react";

export type MenuItem = { title: string; url: string };
export type MenuGroup = { label: string; icon: typeof Users; items: MenuItem[] };

/** Menu real do sistema — fonte única para o menu lateral e a página Acessos. */
const RAW_GROUPS: MenuGroup[] = [
  { label: "Dashboard", icon: LayoutDashboard, items: [{ title: "Dashboard", url: "/dashboard" }] },
  {
    label: "Planejamento",
    icon: CalendarDays,
    items: [
      { title: "Programação", url: "/programacao/diaria" },
      { title: "Serviços", url: "/programacao/servicos" },
      { title: "Transporte", url: "/veiculos/transporte" },
    ],
  },
  {
    label: "Controles",
    icon: ClipboardList,
    items: [
      { title: "Integrações", url: "/obras/integracoes" },
      { title: "Treinamentos", url: "/treinamentos" },
      { title: "ASOs", url: "/colaboradores/asos" },
    ],
  },
  {
    label: "Agendamentos",
    icon: CalendarClock,
    items: [
      { title: "Agendamentos", url: "/agendamentos" },
      { title: "Conferência", url: "/conferencia" },
      { title: "Consulta", url: "/consulta" },
    ],
  },
  {
    label: "Colaboradores",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores" },
      { title: "Funções", url: "/colaboradores/estrutura" },
      { title: "Turnos", url: "/colaboradores/turnos" },
    ],
  },
  {
    label: "Obras",
    icon: Building2,
    items: [
      { title: "Serviços", url: "/obras" },
      { title: "Resultados", url: "/obras/resultado" },
      { title: "Clientes", url: "/clientes" },
    ],
  },
  {
    label: "Andaimes",
    icon: Boxes,
    items: [
      { title: "Inventário", url: "/andaimes/inventario" },
      { title: "Estoque", url: "/andaimes/estoque" },
      { title: "Solicitações", url: "/andaimes/solicitacoes" },
      { title: "Romaneios", url: "/andaimes/romaneios" },
      { title: "Acompanhamento", url: "/andaimes/acompanhamento" },
      { title: "Patrimônio", url: "/andaimes/patrimonio" },
    ],
  },
  {
    label: "Veículos",
    icon: Truck,
    items: [
      { title: "Frota", url: "/veiculos" },
      { title: "Relatórios", url: "/veiculos/relatorios" },
      { title: "Motoristas", url: "/veiculos/motoristas" },
    ],
  },
  {
    label: "Ausências",
    icon: CalendarOff,
    items: [
      { title: "Férias", url: "/ausencias/ferias" },
      { title: "Atestados", url: "/ausencias/atestados" },
      { title: "Folgas", url: "/ausencias/folgas" },
    ],
  },
  {
    label: "Benefícios",
    icon: Wallet,
    items: [
      { title: "Vale-Transporte", url: "/beneficios/vale-transporte" },
      { title: "Prêmio de Viagem", url: "/beneficios/premio-viagem" },
      { title: "Prêmio de Motorista", url: "/beneficios/premio-motorista" },
    ],
  },
  {
    label: "Fechamentos",
    icon: Wallet,
    items: [
      { title: "Financeiro", url: "/fechamentos/financeiro" },
      { title: "Premiações", url: "/fechamento" },
      { title: "Pedidos", url: "/fechamentos/suzano" },
    ],
  },
  { label: "Relatórios", icon: FileBarChart, items: [{ title: "Alocações", url: "/relatorios" }, { title: "Ajuste de Ponto", url: "/relatorios/ajuste-ponto" }, { title: "Relatório Diário", url: "/externo/relatorio-diario" }] },
  { label: "Demandas", icon: ClipboardList, items: [{ title: "Certificados", url: "/demandas/certificados" }, { title: "Contratações", url: "/demandas/contratacoes" }] },
  {
    label: "Administração",
    icon: Shield,
    items: [
      { title: "Usuários", url: "/admin/usuarios" },
      { title: "Configurações", url: "/admin/configuracoes" },
      { title: "Acessos", url: "/admin/acessos" },
    ],
  },
];

const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR");
/** Grupos na ordem original; páginas de cada grupo em ordem alfabética. */
export const MENU_GROUPS: MenuGroup[] = RAW_GROUPS.map((g) => ({
  ...g,
  // Andaimes segue a ordem do processo, não alfabética
  items: g.label === "Andaimes" ? g.items : [...g.items].sort((a, b) => byName(a.title, b.title)),
}));

export const ALL_MENU_URLS = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.url));

/** Página do menu que "contém" a rota atual (ex.: /programacao/semanal → Programação). */
export function menuUrlFor(pathname: string): string | null {
  if (ALL_MENU_URLS.includes(pathname)) return pathname;
  if (pathname.startsWith("/programacao")) return "/programacao/diaria";
  return null;
}

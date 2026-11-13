import {
  Award,
  Bus,
  Calculator,
  ChartPie,
  ClipboardCheck,
  Clock,
  FileCheck,
  FileText,
  Fuel,
  Gauge,
  GraduationCap,
  Inbox,
  KeyRound,
  Landmark,
  ListChecks,
  NotebookPen,
  Receipt,
  Route,
  Search,
  Settings,
  ShoppingCart,
  TrendingUp,
  UserCog,
  UserPlus,
  UserX,
  Utensils,
  Wrench,
  type LucideIcon,
  CalendarDays,
  CalendarClock,
  Users,
  Building2,
  Truck,
  Wallet,
  FileBarChart,
  Shield,
  ClipboardList,
  Boxes,
} from "lucide-react";

export type MenuItem = { title: string; url: string; icon?: LucideIcon };
export type MenuGroup = { label: string; icon: typeof Users; items: MenuItem[] };

/** Menu real do sistema — fonte única para o menu lateral e a página Acessos. */
const RAW_GROUPS: MenuGroup[] = [
  {
    label: "Planejamento",
    icon: CalendarDays,
    items: [
      { title: "Programação", url: "/programacao/diaria", icon: CalendarDays },
      { title: "Serviços", url: "/programacao/servicos", icon: ListChecks },
      { title: "Transporte", url: "/veiculos/transporte", icon: Bus },
    ],
  },
  {
    label: "Controles",
    icon: CalendarClock,
    items: [
      { title: "Documentação", url: "/agendamentos", icon: FileCheck },
      { title: "Conferência", url: "/conferencia", icon: ClipboardCheck },
      { title: "Consulta", url: "/consulta", icon: Search },
    ],
  },
  {
    label: "Funcionários",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores", icon: Users },
      { title: "Ausências", url: "/ausencias", icon: UserX },
      { title: "Contratações", url: "/demandas/contratacoes", icon: UserPlus },
    ],
  },
  {
    label: "Frota",
    icon: Truck,
    items: [
      { title: "Abastecimento", url: "/frota/notas", icon: Fuel },
      { title: "Manutenção", url: "/frota/manutencao", icon: Wrench },
      { title: "Visão Geral", url: "/frota/custos", icon: Gauge },
    ],
  },
  {
    label: "Obras",
    icon: Building2,
    items: [
      { title: "Cadastros", url: "/obras", icon: Building2 },
      { title: "Fechamento", url: "/fechamentos/financeiro", icon: Calculator },
      { title: "Resultados", url: "/obras/resultado", icon: TrendingUp },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    items: [
      { title: "Compras", url: "/obras/compras", icon: ShoppingCart },
      { title: "Pedidos", url: "/fechamentos/suzano", icon: Receipt },
      { title: "Faturamento", url: "/relatorios/sincronizacao", icon: FileText },
    ],
  },
  { label: "Relatórios", icon: FileBarChart, items: [{ title: "Ajuste de Ponto", url: "/relatorios/ajuste-ponto", icon: Clock }, { title: "Premiações", url: "/fechamento", icon: Award }, { title: "Vale Alimentação", url: "/relatorios/vale-alimentacao", icon: Utensils }] },
  { label: "Demandas", icon: ClipboardList, items: [{ title: "Alocações", url: "/relatorios", icon: ChartPie }, { title: "Certificados", url: "/demandas/certificados", icon: GraduationCap }, { title: "Relatório Diário", url: "/externo/relatorio-diario", icon: NotebookPen }] },
  {
    label: "Andaimes",
    icon: Boxes,
    items: [
      { title: "Inventário", url: "/andaimes/inventario", icon: ClipboardList },
      { title: "Estoque", url: "/andaimes/estoque", icon: Boxes },
      { title: "Solicitações", url: "/andaimes/solicitacoes", icon: Inbox },
      { title: "Acompanhamento", url: "/andaimes/acompanhamento", icon: Route },
      { title: "Patrimônio", url: "/andaimes/patrimonio", icon: Landmark },
    ],
  },
  {
    label: "Administração",
    icon: Shield,
    items: [
      { title: "Usuários", url: "/admin/usuarios", icon: UserCog },
      { title: "Configurações", url: "/admin/configuracoes", icon: Settings },
      { title: "Acessos", url: "/admin/acessos", icon: KeyRound },
    ],
  },
];

const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR");
/** Grupos na ordem original; páginas de cada grupo em ordem alfabética. */
export const MENU_GROUPS: MenuGroup[] = RAW_GROUPS.map((g) => ({
  ...g,
  // Andaimes segue a ordem do processo, não alfabética
  // Andaimes segue a ordem do processo; em Controles, Documentação vem primeiro
  items:
    g.label === "Andaimes" || g.label === "Frota"
      ? g.items
      : [...g.items].sort((a, b) =>
          g.label === "Controles" && (a.url === "/agendamentos" || b.url === "/agendamentos")
            ? (a.url === "/agendamentos" ? -1 : 1)
            : byName(a.title, b.title),
        ),
}));

export const ALL_MENU_URLS = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.url));

/** Página do menu que "contém" a rota atual (ex.: /programacao/semanal → Programação). */
export function menuUrlFor(pathname: string): string | null {
  if (ALL_MENU_URLS.includes(pathname)) return pathname;
  if (pathname.startsWith("/programacao")) return "/programacao/diaria";
  if (pathname === "/clientes") return "/obras";
  return null;
}

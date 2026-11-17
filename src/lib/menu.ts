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
  Users,
  Building2,
  Truck,
  Wallet,
  Shield,
  ClipboardList,
  Boxes,
  ShieldCheck,
  FilePlus,
  PackageCheck,
  BadgeCheck,
} from "lucide-react";

/** url = chave de acesso (Acessos); to = para onde o menu leva, quando diferente (ex.: Clientes abre em /clientes). */
export type MenuItem = { title: string; url: string; icon?: LucideIcon; to?: string };
/** userMenu = grupo que fica no menu do usuário (rodapé), fora da lista principal (ex.: Administração). */
export type MenuGroup = { label: string; icon: typeof Users; items: MenuItem[]; userMenu?: boolean };

/**
 * Menu real do sistema — fonte única para o menu lateral e a página Acessos.
 * Módulos por área de trabalho; páginas sempre em ordem alfabética.
 */
const RAW_GROUPS: MenuGroup[] = [
  {
    label: "Operação",
    icon: CalendarDays,
    items: [
      { title: "Programação", url: "/programacao/diaria", icon: CalendarDays },
      { title: "Serviços", url: "/programacao/servicos", icon: ListChecks },
      { title: "Transporte", url: "/veiculos/transporte", icon: Bus },
    ],
  },
  {
    label: "Funcionários",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores", icon: Users },
      { title: "Ausências", url: "/ausencias", icon: UserX },
      { title: "Contratações", url: "/demandas/contratacoes", icon: UserPlus },
      { title: "Consulta", url: "/consulta", icon: Search },
    ],
  },
  {
    label: "Documentos",
    icon: ShieldCheck,
    items: [
      { title: "Documentação", url: "/agendamentos", icon: FileCheck },
      { title: "Conferência", url: "/conferencia", icon: ClipboardCheck },
      { title: "Certificados", url: "/demandas/certificados", icon: GraduationCap },
    ],
  },
  {
    label: "Remuneração",
    icon: Wallet,
    items: [
      { title: "Ajuste de Ponto", url: "/relatorios/ajuste-ponto", icon: Clock },
      { title: "Premiações", url: "/fechamento", icon: Award },
      { title: "Vale Alimentação", url: "/relatorios/vale-alimentacao", icon: Utensils },
      { title: "Alocações", url: "/relatorios", icon: ChartPie },
    ],
  },
  {
    label: "Serviços",
    icon: Building2,
    items: [
      { title: "Clientes", url: "/obras", to: "/clientes", icon: Building2 },
      { title: "Resultados", url: "/obras/resultado", icon: TrendingUp },
      { title: "Fechamento", url: "/fechamentos/financeiro", icon: Calculator },
      { title: "Relatório Diário", url: "/externo/relatorio-diario", icon: NotebookPen },
    ],
  },
  {
    label: "Financeiro",
    icon: Receipt,
    items: [
      { title: "Pedidos", url: "/fechamentos/suzano", icon: Receipt },
      { title: "Faturamento", url: "/relatorios/sincronizacao", icon: FileText },
    ],
  },
  {
    // Solicitações de compra (SC): solicitante → Autorização (gestor do cliente) → Comprador (subaba Autorizantes). Relatório = a antiga aba Compras (mesma chave de acesso).
    label: "Compras",
    icon: ShoppingCart,
    items: [
      { title: "Solicitações", url: "/compras/solicitacoes", icon: FilePlus },
      { title: "Autorização", url: "/compras/aprovacao", icon: BadgeCheck },
      { title: "Comprador", url: "/compras/comprador", icon: PackageCheck },
      { title: "Relatório", url: "/obras/compras", icon: ChartPie },
    ],
  },
  {
    label: "Veículos",
    icon: Truck,
    items: [
      { title: "Abastecimento", url: "/frota/notas", icon: Fuel },
      { title: "Manutenção", url: "/frota/manutencao", icon: Wrench },
      { title: "Visão Geral", url: "/frota/custos", icon: Gauge },
    ],
  },
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
    userMenu: true,
    items: [
      { title: "Usuários", url: "/admin/usuarios", icon: UserCog },
      { title: "Configurações", url: "/admin/configuracoes", icon: Settings },
      { title: "Acessos", url: "/admin/acessos", icon: KeyRound },
    ],
  },
];

const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR");
/** Módulos na ordem acima; páginas de cada módulo em ordem alfabética. */
export const MENU_GROUPS: MenuGroup[] = RAW_GROUPS.map((g) => ({ ...g, items: [...g.items].sort((a, b) => byName(a.title, b.title)) }));

export const ALL_MENU_URLS = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.url));

/** Página do menu que "contém" a rota atual (ex.: /ausencias/ferias → Ausências). */
export function menuUrlFor(pathname: string): string | null {
  if (ALL_MENU_URLS.includes(pathname)) return pathname;
  if (pathname.startsWith("/programacao")) return "/programacao/diaria";
  if (pathname === "/clientes") return "/obras";
  if (pathname.startsWith("/ausencias")) return "/ausencias";
  // Página de uma SC: a RLS decide quem vê (solicitante, observador, autorizante ou comprador), sem trava de página.
  if (pathname.startsWith("/compras/solicitacoes/")) return null;
  return null;
}

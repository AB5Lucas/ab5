import {
  LayoutDashboard,
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
    icon: CalendarClock,
    items: [
      { title: "Documentação", url: "/agendamentos" },
      { title: "Conferência", url: "/conferencia" },
      { title: "Consulta", url: "/consulta" },
    ],
  },
  {
    label: "Funcionários",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores" },
      { title: "Ausências", url: "/ausencias" },
      { title: "Premiações", url: "/fechamento" },
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
    label: "Financeiro",
    icon: Wallet,
    items: [
      { title: "Fechamento", url: "/fechamentos/financeiro" },
      { title: "Pedidos", url: "/fechamentos/suzano" },
      { title: "Sincronização", url: "/relatorios/sincronizacao" },
    ],
  },
  { label: "Relatórios", icon: FileBarChart, items: [{ title: "Ajuste de Ponto", url: "/relatorios/ajuste-ponto" }, { title: "Alocações", url: "/relatorios" }, { title: "Relatório Diário", url: "/externo/relatorio-diario" }] },
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
  // Andaimes segue a ordem do processo; em Controles, Documentação vem primeiro
  items:
    g.label === "Andaimes"
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
  return null;
}

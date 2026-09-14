import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Building2,
  Truck,
  GraduationCap,
  CalendarOff,
  Wallet,
  FileBarChart,
  Shield,
  HardHat,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type Item = { title: string; url: string };
type Group = { label: string; icon: typeof Users; items: Item[] };

const groups: Group[] = [
  { label: "Dashboard", icon: LayoutDashboard, items: [{ title: "Dashboard", url: "/dashboard" }] },
  {
    label: "Programação",
    icon: CalendarDays,
    items: [
      { title: "Hoje", url: "/programacao/hoje" },
      { title: "Programação Diária", url: "/programacao/diaria" },
      { title: "Overview Semanal", url: "/programacao/semanal" },
      { title: "Histórico", url: "/programacao/historico" },
    ],
  },
  {
    label: "Colaboradores",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores" },
      { title: "Cargos e Setores", url: "/colaboradores/estrutura" },
    ],
  },
  {
    label: "Obras",
    icon: Building2,
    items: [
      { title: "Obras", url: "/obras" },
      { title: "Equipes Base", url: "/obras/equipes-base" },
      { title: "Requisitos", url: "/obras/requisitos" },
    ],
  },
  {
    label: "Veículos",
    icon: Truck,
    items: [
      { title: "Frota", url: "/veiculos" },
      { title: "Motoristas", url: "/veiculos/motoristas" },
      { title: "Transporte", url: "/veiculos/transporte" },
    ],
  },
  { label: "Treinamentos", icon: GraduationCap, items: [{ title: "Treinamentos", url: "/treinamentos" }] },
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
    ],
  },
  { label: "Relatórios", icon: FileBarChart, items: [{ title: "Relatórios", url: "/relatorios" }] },
  {
    label: "Administração",
    icon: Shield,
    items: [
      { title: "Usuários", url: "/admin/usuarios" },
      { title: "Auditoria", url: "/admin/auditoria" },
      { title: "Configurações", url: "/admin/configuracoes" },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <HardHat className="h-4 w-4" />
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold tracking-wide uppercase">Programação</p>
              <p className="text-xs text-sidebar-foreground/60">Sistema Operacional</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <group.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

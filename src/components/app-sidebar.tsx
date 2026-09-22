import { Link, useRouterState } from "@tanstack/react-router";
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
  HardHat,
  ClipboardList,
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
    label: "Planejamento",
    icon: CalendarDays,
    items: [
      { title: "Programação", url: "/programacao/diaria" },
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
    ],
  },
  {
    label: "Colaboradores",
    icon: Users,
    items: [
      { title: "Colaboradores", url: "/colaboradores" },
      { title: "Funções", url: "/colaboradores/estrutura" },
    ],
  },
  {
    label: "Obras",
    icon: Building2,
    items: [
      { title: "Serviços", url: "/obras" },
      { title: "Clientes", url: "/clientes" },
      { title: "Requisitos", url: "/obras/requisitos" },
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

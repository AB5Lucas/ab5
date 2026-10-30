import { Link, useRouterState } from "@tanstack/react-router";
import { Building2, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
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
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";

const STORAGE_KEY = "sidebar-closed-groups";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = (label: string) =>
    setClosed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  const visible = loading
    ? []
    : MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.url)) })).filter((g) => g.items.length);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold tracking-wide uppercase">AB5 Hub</p>
              <p className="text-xs text-sidebar-foreground/60">Sistema Operacional</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {visible.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel asChild>
                <button
                  type="button"
                  onClick={() => toggle(group.label)}
                  className="flex w-full items-center gap-1 text-left"
                >
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 opacity-50 transition-transform ${closed[group.label] ? "-rotate-90" : ""}`}
                  />
                  {group.label}
                </button>
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent className={!collapsed && closed[group.label] ? "hidden" : ""}>
              <SidebarMenu>
                {group.items.map((item) => {
                  const b = badges[item.url];
                  return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                      <Link to={item.url} className="relative flex items-center gap-2">
                        <group.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                        {b && (collapsed ? (
                          <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${b.tone === "red" ? "bg-destructive" : "bg-warning"}`} />
                        ) : (
                          <span
                            title={b.tone === "red" ? "Vencidos/pendentes" : "A vencer"}
                            className={`ml-auto min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}
                          >
                            {b.count > 99 ? "99+" : b.count}
                          </span>
                        ))}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

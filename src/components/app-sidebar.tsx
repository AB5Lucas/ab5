import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, LayoutList, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MENU_GROUPS, menuUrlFor, type MenuGroup, type MenuItem } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { BadgePill, openMenuSearch, useFavorites, useMenuStyle, worstTone } from "@/components/nav/menu-prefs";

const STORAGE_KEY = "sidebar-closed-groups";
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * Menu lateral: um ícone por página, página atual com barra vermelha, avisos com detalhe ao passar o mouse,
 * grupo fechado mostra o pior aviso, favoritos no topo, busca (Ctrl+K) e, recolhido, um ícone por grupo com a lista
 * ao clicar. O menu antigo segue disponível em "Usar menu clássico" (rodapé).
 */
export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const current = menuUrlFor(pathname) ?? pathname;
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const { user, profile, role } = useCurrentUser();
  const { favs, toggle: toggleFav, isFav } = useFavorites(user?.id);
  const [, setStyle] = useMenuStyle();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setClosed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")); } catch { /* ignora */ }
  }, []);
  const toggleGroup = (label: string) => setClosed((prev) => {
    const next = { ...prev, [label]: !prev[label] };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignora */ }
    return next;
  });
  const visible = loading ? [] : MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.url)) })).filter((g) => g.items.length);
  const favItems = visible.flatMap((g) => g.items.map((i) => ({ item: i, group: g }))).filter((x) => favs.includes(x.item.url));
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const initials = (profile?.full_name || profile?.email || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  const itemRow = (item: MenuItem, group: MenuGroup, keyPrefix = "") => {
    const b = badges[item.url];
    const Icon = item.icon ?? group.icon;
    const active = current === item.url;
    return (
      <SidebarMenuItem key={keyPrefix + item.url}>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}
          className="relative h-9 rounded-lg text-sidebar-foreground transition-colors data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground">
          <Link to={item.url} onClick={closeMobile} className="flex items-center gap-2.5">
            {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-sidebar-primary" aria-hidden />}
            <Icon className={`h-4 w-4 shrink-0 ${active ? "text-sidebar-primary" : "opacity-90"}`} />
            <span className="truncate">{item.title}</span>
            {b && <BadgePill b={b} className="ml-auto" />}
          </Link>
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={() => toggleFav(item.url)} title={isFav(item.url) ? "Tirar dos favoritos" : "Fixar nos favoritos"} aria-label="Favorito">
          <Star className={`h-3.5 w-3.5 ${isFav(item.url) ? "fill-warning text-warning" : ""}`} />
        </SidebarMenuAction>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 font-display text-xs font-bold tracking-tight text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/30">
            AB5
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold uppercase tracking-wide">AB5 Hub</p>
              <p className="text-[11px] text-sidebar-foreground/75">Gestão de obras e equipes</p>
            </div>
          )}
        </div>
        {collapsed ? (
          <SidebarMenu><SidebarMenuItem>
            <SidebarMenuButton tooltip="Buscar página (Ctrl+K)" onClick={openMenuSearch}><Search className="h-4 w-4" /></SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu>
        ) : (
          <button type="button" onClick={openMenuSearch}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
            <Search className="h-4 w-4" /> Buscar página...
            <kbd className="ml-auto rounded border border-sidebar-border px-1.5 font-mono text-[10px]">{isMac ? "⌘" : "Ctrl"} K</kbd>
          </button>
        )}
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {collapsed ? (
          // Recolhido: um ícone por grupo; clique abre as páginas do grupo ao lado.
          <SidebarGroup><SidebarMenu className="gap-1">
            {visible.map((group) => {
              const tone = worstTone(group.items.map((i) => badges[i.url]));
              const activeGroup = group.items.some((i) => i.url === current);
              return (
                <SidebarMenuItem key={group.label}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton isActive={activeGroup} tooltip={group.label} className="relative data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary">
                        <group.icon className="h-4 w-4" />
                        {tone && <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-sidebar ${tone === "red" ? "bg-destructive" : "bg-warning"}`} />}
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-60">
                      <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">{group.label}</DropdownMenuLabel>
                      {group.items.map((item) => {
                        const Icon = item.icon ?? group.icon;
                        const b = badges[item.url];
                        return (
                          <DropdownMenuItem key={item.url} asChild className={current === item.url ? "bg-accent font-semibold" : ""}>
                            <Link to={item.url} className="flex items-center gap-2"><Icon className="h-4 w-4" />{item.title}{b && <BadgePill b={b} className="ml-auto" />}</Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu></SidebarGroup>
        ) : (
          <>
            {favItems.length > 0 && (
              <SidebarGroup className="py-1">
                <SidebarGroupLabel className="h-7 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/80">
                  <Star className="mr-1.5 h-3 w-3" /> Favoritos
                </SidebarGroupLabel>
                <SidebarGroupContent><SidebarMenu className="gap-0.5">{favItems.map(({ item, group }) => itemRow(item, group, "fav-"))}</SidebarMenu></SidebarGroupContent>
              </SidebarGroup>
            )}
            {visible.map((group) => {
              const hasCurrent = group.items.some((i) => i.url === current);
              // O grupo da página atual fica sempre aberto.
              const isClosed = !!closed[group.label] && !hasCurrent;
              const tone = worstTone(group.items.map((i) => badges[i.url]));
              return (
                // Grupo em uso: destacado num cartão, com espaço acima e abaixo do resto do menu.
                <SidebarGroup key={group.label} className={hasCurrent ? "mx-2 my-2.5 w-auto rounded-xl bg-sidebar-accent/35 px-1 py-1.5 ring-1 ring-sidebar-border" : "py-1"}>
                  <SidebarGroupLabel asChild className={`h-7 text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-sidebar-foreground ${hasCurrent ? "text-sidebar-foreground" : "text-sidebar-foreground/80"}`}>
                    <button type="button" onClick={() => toggleGroup(group.label)} className="flex w-full items-center gap-1.5 text-left" aria-expanded={!isClosed}>
                      <group.icon className="h-3 w-3" />
                      {group.label}
                      {isClosed && tone && (
                        <span title="Há avisos neste grupo" className={`h-2 w-2 rounded-full ${tone === "red" ? "bg-destructive" : "bg-warning"}`} />
                      )}
                      {isClosed ? <ChevronRight className="ml-auto h-3 w-3 opacity-80" /> : <ChevronDown className="ml-auto h-3 w-3 opacity-80" />}
                    </button>
                  </SidebarGroupLabel>
                  {!isClosed && (
                    <SidebarGroupContent><SidebarMenu className="gap-0.5">{group.items.map((item) => itemRow(item, group))}</SidebarMenu></SidebarGroupContent>
                  )}
                </SidebarGroup>
              );
            })}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-11" tooltip={profile?.full_name ?? "Usuário"}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold">{initials}</span>
              {!collapsed && (
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-medium">{profile?.full_name || profile?.email}</span>
                  <span className="block truncate text-[11px] text-sidebar-foreground/75">{ROLE_LABEL[role]}</span>
                </span>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-56">
            <DropdownMenuItem onSelect={openMenuSearch}><Search className="h-4 w-4" /> Buscar página <span className="ml-auto text-xs text-muted-foreground">{isMac ? "⌘" : "Ctrl"} K</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setStyle("classic")}><LayoutList className="h-4 w-4" /> Usar menu clássico</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

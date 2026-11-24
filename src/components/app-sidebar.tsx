import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronDown, LayoutList, PanelLeftClose, PanelLeftOpen, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MENU_GROUPS, menuUrlFor, type MenuGroup, type MenuItem } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { companyRoleMatch, positionWithoutLevel } from "@/lib/company-role";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { BadgePill, openMenuSearch, useFavorites, useMenuStyle, worstTone } from "@/components/nav/menu-prefs";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const dotClass = (tone: string) => (tone === "red" ? "bg-destructive" : "bg-warning");

/**
 * Menu lateral (modelo B): módulos em árvore, só o da página atual aberto, com as subabas da página embaixo dela.
 * Botão quadrado ao lado de Buscar recolhe para a faixa de ícones; recolhido, clicar num módulo abre um quadro
 * pequeno com as páginas. Administração fica no menu do usuário (rodapé). O menu antigo segue em "Usar menu clássico".
 */
export function AppSidebar() {
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const current = menuUrlFor(pathname) ?? pathname;
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const { user, profile, role } = useCurrentUser();
  const { favs, toggle: toggleFav, isFav } = useFavorites(user?.id);
  const [, setStyle] = useMenuStyle();
  // Função na empresa (cadastro de Colaboradores, sem nível) no lugar do perfil do sistema; sem casamento, o perfil.
  // Lê só nome/situação (sem o cargo de todos) e busca o cargo apenas do colaborador casado; guarda só o texto.
  const companyRoleQ = useQuery({
    queryKey: ["company-role", profile?.full_name ?? ""],
    staleTime: 30 * 60_000,
    enabled: !!profile?.full_name,
    queryFn: async () => {
      const people = (await fetchAll<{ full_name: string; status: string | null; position_id: string | null }>((a, b) =>
        supabase.from("collaborators").select("full_name, status, position_id").order("id").range(a, b)))
        .map((c) => ({ full_name: c.full_name, active: c.status === "active", position_id: c.position_id }));
      const hit = companyRoleMatch(profile?.full_name, people);
      if (!hit?.position_id) return null;
      const { data } = await supabase.from("positions").select("name").eq("id", hit.position_id).maybeSingle();
      return positionWithoutLevel(data?.name ?? null);
    },
  });
  // Sem cadastro em Colaboradores (casamento único pelo nome) = Externo.
  const roleTitle = companyRoleQ.isLoading ? "" : companyRoleQ.data ?? "Externo";
  // Um módulo aberto por vez: o da página atual, salvo se o usuário abrir/fechar outro.
  const [openMod, setOpenMod] = useState<string | null | undefined>(undefined);
  const [fly, setFly] = useState<string | null>(null);
  // Página aberta pelos Fixados não expande o módulo dela (fica tudo recolhido).
  const fromFav = useRef(false);
  useEffect(() => { setOpenMod(fromFav.current ? null : undefined); fromFav.current = false; setFly(null); }, [current]);

  const all = loading ? [] : MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.url)) })).filter((g) => g.items.length);
  const modules = all.filter((g) => !g.userMenu);
  const adminItems = all.filter((g) => g.userMenu).flatMap((g) => g.items.map((i) => ({ item: i, group: g })));
  const currentMod = modules.find((g) => g.items.some((i) => i.url === current))?.label ?? null;
  const openLabel = openMod === undefined ? currentMod : openMod;
  const favItems = all.flatMap((g) => g.items.map((i) => ({ item: i, group: g }))).filter((x) => favs.includes(x.item.url));
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const initials = (profile?.full_name || profile?.email || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  const pageRow = (item: MenuItem, group: MenuGroup, opts: { icon?: boolean; key?: string; fav?: boolean; delay?: number } = {}) => {
    const Icon = item.icon ?? group.icon;
    const active = current === item.url;
    const b = badges[item.url];
    return (
      <SidebarMenuItem key={(opts.key ?? "") + item.url} {...(opts.delay != null ? { className: "menu-stagger", style: { animationDelay: `${opts.delay}ms` } } : {})}>
        <SidebarMenuButton asChild isActive={active}
          className="relative h-8 rounded-lg text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold">
          <Link to={item.to ?? item.url} onClick={() => { if (opts.fav) { if (current === item.url) setOpenMod(null); else fromFav.current = true; } closeMobile(); }} className="menu-row flex items-center gap-2.5 pr-2">
            {active && <span className="menu-active-bar absolute inset-y-1.5 -left-2 w-[3px] rounded-r-full bg-sidebar-primary" aria-hidden />}
            {opts.icon && <Icon className={`h-4 w-4 shrink-0 ${active ? "text-sidebar-primary" : "opacity-90"}`} />}
            <span className="truncate">{item.title}</span>
            {/* Aviso e estrela alinhados à direita, com margem da borda. */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {b && <BadgePill b={b} />}
              {/* Estrela na direita, depois do aviso (aparece ao passar o mouse; fixada fica sempre visível). */}
              <span role="button" tabIndex={0} aria-label={isFav(item.url) ? "Tirar dos fixados" : "Fixar no topo do menu"} title={isFav(item.url) ? "Tirar dos fixados" : "Fixar no topo do menu"}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(item.url); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleFav(item.url); } }}
                className={`shrink-0 rounded p-0.5 transition-opacity hover:bg-sidebar-border/60 focus-visible:opacity-100 ${isFav(item.url) ? "opacity-100" : "opacity-0 group-hover/menu-item:opacity-100"}`}>
                <Star className={`h-3 w-3 ${isFav(item.url) ? "fill-warning text-warning" : "text-sidebar-foreground/70"}`} />
              </span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const userMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="h-11" tooltip={profile?.full_name ?? "Usuário"}>
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold">
            {initials}
            {/* Bolinha vermelha: algum aviso da Administração (ex.: usuário novo aguardando acesso). */}
            {adminItems.some(({ item }) => badges[item.url]) && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-sidebar" aria-label="Avisos na Administração" />
            )}
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium">{profile?.full_name || profile?.email}</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/75">{roleTitle}</span>
            </span>
          )}
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-56">
        {adminItems.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">Administração</DropdownMenuLabel>
            {adminItems.map(({ item, group }) => {
              const Icon = item.icon ?? group.icon;
              return (
                <DropdownMenuItem key={item.url} asChild>
                  <Link to={item.to ?? item.url} onClick={closeMobile}>
                    <Icon className="h-4 w-4" /> {item.title}
                    {badges[item.url] && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" title={badges[item.url]!.detail ?? undefined} />}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link to="/notificacoes" search={{ aba: "preferencias" }} onClick={closeMobile}><Bell className="h-4 w-4" /> Notificações</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openMenuSearch}><Search className="h-4 w-4" /> Buscar <span className="ml-auto text-xs text-muted-foreground">{isMac ? "⌘" : "Ctrl"} K</span></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setStyle("classic")}><LayoutList className="h-4 w-4" /> Usar menu clássico</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const toggleBtn = (
    <button type="button" onClick={toggleSidebar} title={collapsed ? "Estender menu" : "Recolher menu"} aria-label={collapsed ? "Estender menu" : "Recolher menu"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/60 text-sidebar-foreground transition-colors hover:bg-sidebar-accent">
      {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  );

  return (
    <Sidebar collapsible="icon" className="overflow-x-hidden">
      <SidebarHeader className={`gap-3 border-b border-sidebar-border py-4 ${collapsed ? "items-center px-1" : "px-3"}`}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary font-display text-xs font-bold tracking-tight text-sidebar-primary-foreground">AB5</span>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold uppercase tracking-wide">AB5 Hub</p>
              <p className="text-[11px] text-sidebar-foreground/75">Gestão de obras e equipes</p>
            </div>
          )}
        </div>
        {collapsed ? (
          <div className="grid justify-items-center gap-1">
            {!isMobile && toggleBtn}
            <SidebarMenu><SidebarMenuItem>
              <SidebarMenuButton tooltip="Buscar (Ctrl+K)" onClick={openMenuSearch}><Search className="h-4 w-4" /></SidebarMenuButton>
            </SidebarMenuItem></SidebarMenu>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={openMenuSearch} title="Buscar (Ctrl+K)"
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
              <Search className="h-4 w-4" /> Buscar
            </button>
            {!isMobile && toggleBtn}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-x-hidden px-2 py-2">
        {collapsed ? (
          <SidebarMenu className="gap-1">
            {modules.map((g) => {
              const tone = worstTone(g.items.map((i) => badges[i.url]));
              const isCur = g.label === currentMod;
              return (
                <SidebarMenuItem key={g.label}>
                  <Popover open={fly === g.label} onOpenChange={(o) => setFly(o ? g.label : null)}>
                    <PopoverTrigger asChild>
                      <SidebarMenuButton isActive={isCur} {...(fly === g.label ? {} : { tooltip: g.label })}
                        className="relative data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary">
                        <g.icon className="h-4 w-4" />
                        {tone && <span className={`menu-dot absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-sidebar ${dotClass(tone)}`} />}
                      </SidebarMenuButton>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" sideOffset={10}
                      className="w-56 border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground">
                      <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/75">
                        <g.icon className="h-3 w-3" /> {g.label}
                      </p>
                      <div className="grid gap-px">
                        {g.items.map((i, k) => {
                          const b = badges[i.url];
                          return (
                            <Link key={i.url} to={i.to ?? i.url} onClick={() => setFly(null)} style={{ animationDelay: `${Math.min(k, 12) * 25}ms` }}
                              className={`menu-stagger menu-row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent ${current === i.url ? "bg-sidebar-accent font-semibold" : ""}`}>
                              <span className="truncate">{i.title}</span>
                              {b && <BadgePill b={b} className="ml-auto" />}
                            </Link>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        ) : (
          <>
            {favItems.length > 0 && (
              <div className="mb-2 border-b border-sidebar-border pb-2">
                <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/75">
                  <Star className="h-3 w-3" /> Fixados
                </p>
                <SidebarMenu className="gap-0.5">{favItems.map(({ item, group }) => pageRow(item, group, { icon: true, key: "fav-", fav: true }))}</SidebarMenu>
              </div>
            )}
            <SidebarMenu className="gap-0.5">
              {modules.map((g) => {
                const open = openLabel === g.label;
                const tone = worstTone(g.items.map((i) => badges[i.url]));
                return (
                  <SidebarMenuItem key={g.label} className="menu-stagger" style={{ animationDelay: `${modules.indexOf(g) * 35}ms` }}>
                    <SidebarMenuButton onClick={() => setOpenMod(open ? null : g.label)} aria-expanded={open}
                      className={`h-9 rounded-lg text-sidebar-foreground ${open ? "font-semibold" : ""}`}>
                      <g.icon className="h-4 w-4 opacity-90" />
                      <span className="truncate">{g.label}</span>
                      {!open && tone && <span title="Há avisos neste módulo" className={`menu-dot ml-auto h-2 w-2 shrink-0 rounded-full ${dotClass(tone)}`} />}
                      <ChevronDown className={`${!open && tone ? "" : "ml-auto"} h-4 w-4 opacity-70 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
                    </SidebarMenuButton>
                    {open && (
                      <SidebarMenu className="menu-sub mb-1 ml-4 mt-0.5 w-auto gap-0.5 border-l border-sidebar-border pl-2">
                        {g.items.map((i, k) => pageRow(i, g, { delay: Math.min(k, 12) * 25 }))}
                      </SidebarMenu>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">{userMenu}</SidebarFooter>
    </Sidebar>
  );
}

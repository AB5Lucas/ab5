/**
 * Menu flutuante (estilo do vídeo de referência): faixa escura arredondada presa à esquerda, só com ícones dos
 * módulos; passar o mouse mostra o nome, clicar abre o quadro com as páginas (e a Visão geral, se o módulo tiver).
 * Sem logo e sem botão de estender; o último botão é Configurações (usuário, Administração, Notificações, Buscar
 * e a troca para o menu lateral). No celular vira uma barra embaixo.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, LayoutList, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MENU_GROUPS, menuUrlFor } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { BadgePill, openMenuSearch, useMenuStyle, worstTone } from "@/components/nav/menu-prefs";
import { cn } from "@/lib/utils";

const dotClass = (tone: string) => (tone === "red" ? "bg-destructive" : "bg-warning");

function RailButton({ label, active, children, onClick, dot }: { label: string; active?: boolean; children: React.ReactNode; onClick?: () => void; dot?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-label={label}
          className={cn("rail-btn relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
            active ? "bg-background text-foreground shadow" : "text-background/70 hover:bg-background/15 hover:text-background")}>
          {children}
          {dot && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-foreground", dotClass(dot))} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function RailMenu() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const current = menuUrlFor(pathname) ?? pathname;
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const { profile, role } = useCurrentUser();
  const [, setStyle] = useMenuStyle();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [current]);

  const all = loading ? [] : MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.url)) })).filter((g) => g.items.length);
  const modules = all.filter((g) => !g.userMenu);
  const adminItems = all.filter((g) => g.userMenu).flatMap((g) => g.items.map((i) => ({ item: i, group: g })));
  const currentMod = modules.find((g) => g.overview === current || g.items.some((i) => i.url === current))?.label ?? null;
  const pageLink = "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent";

  return (
    <>
    <DesktopRail modules={modules} adminItems={adminItems} current={current} currentMod={currentMod} badges={badges} />
    <nav aria-label="Menu"
      className="fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-row gap-1 overflow-x-auto rounded-full bg-foreground p-1.5 text-background shadow-xl md:hidden">
      <RailButton label="Buscar (Ctrl+K)" onClick={openMenuSearch}><Search className="h-4 w-4" /></RailButton>
      <span className="mx-1 my-0.5 shrink-0 bg-background/15 md:h-px md:w-6 h-6 w-px self-center" />
      {modules.map((g) => {
        const tone = worstTone(g.items.map((i) => badges[i.url]));
        return (
          <Popover key={g.label} open={open === g.label} onOpenChange={(o) => setOpen(o ? g.label : null)}>
            <PopoverTrigger asChild>
              <span><RailButton label={g.label} active={g.label === currentMod || open === g.label} dot={tone}><g.icon className="h-4 w-4" /></RailButton></span>
            </PopoverTrigger>
            <PopoverContent side="right" align="center" sideOffset={14} className="rail-pop w-60 rounded-2xl p-1.5">
              <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.label}</p>
              <div className="grid gap-px">
                {g.overview && (
                  <Link to={g.overview as never} onClick={() => setOpen(null)} className={cn(pageLink, current === g.overview && "bg-accent font-semibold")}>Visão geral</Link>
                )}
                {g.items.map((i) => {
                  const b = badges[i.url];
                  const Icon = i.icon ?? g.icon;
                  return (
                    <Link key={i.url} to={i.to ?? i.url} onClick={() => setOpen(null)} className={cn(pageLink, current === i.url && "bg-accent font-semibold")}>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{i.title}</span>
                      {b && <BadgePill b={b} className="ml-auto" />}
                    </Link>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
      <span className="mx-1 my-0.5 shrink-0 bg-background/15 md:h-px md:w-6 h-6 w-px self-center" />
      <Popover open={open === "__settings"} onOpenChange={(o) => setOpen(o ? "__settings" : null)}>
        <PopoverTrigger asChild>
          <span><RailButton label="Configurações" active={open === "__settings"} dot={adminItems.some(({ item }) => badges[item.url]) ? "red" : null}><Settings className="h-4 w-4" /></RailButton></span>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={14} className="rail-pop w-64 rounded-2xl p-1.5">
          <div className="px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
            <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[role]}</p>
          </div>
          {adminItems.length > 0 && (
            <>
              <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Administração</p>
              {adminItems.map(({ item, group }) => {
                const Icon = item.icon ?? group.icon;
                return (
                  <Link key={item.url} to={item.to ?? item.url} onClick={() => setOpen(null)} className={cn(pageLink, current === item.url && "bg-accent font-semibold")}>
                    <Icon className="h-4 w-4 text-muted-foreground" /> {item.title}
                    {badges[item.url] && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                  </Link>
                );
              })}
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <Link to="/notificacoes" search={{ aba: "preferencias" } as never} onClick={() => setOpen(null)} className={pageLink}><Bell className="h-4 w-4 text-muted-foreground" /> Notificações</Link>
          <button type="button" onClick={() => { setOpen(null); openMenuSearch(); }} className={cn(pageLink, "w-full")}><Search className="h-4 w-4 text-muted-foreground" /> Buscar <span className="ml-auto text-xs text-muted-foreground">Ctrl K</span></button>
          <button type="button" onClick={() => setStyle("modern")} className={cn(pageLink, "w-full")}><LayoutList className="h-4 w-4 text-muted-foreground" /> Usar menu lateral</button>
        </PopoverContent>
      </Popover>
    </nav>
    </>
  );
}

type Group = (typeof MENU_GROUPS)[number];
/**
 * Computador: faixa escura compacta (só ícones) que se abre ao passar o mouse, mostrando os nomes dos módulos e,
 * no módulo aberto, as páginas (como o menu lateral). Sai o mouse, volta a ser compacta.
 */
function DesktopRail({ modules, adminItems, current, currentMod, badges }: {
  modules: Group[]; adminItems: { item: Group["items"][number]; group: Group }[]; current: string; currentMod: string | null;
  badges: ReturnType<typeof useMenuBadges>;
}) {
  const { profile, role } = useCurrentUser();
  const [, setStyle] = useMenuStyle();
  const [openMod, setOpenMod] = useState<string | null | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => { setOpenMod(undefined); setSettings(false); }, [current]);
  const openLabel = openMod === undefined ? currentMod : openMod;
  const expanded = hover || settings;
  const row = "flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm transition-colors duration-200";
  const label = cn("truncate whitespace-nowrap transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0");
  return (
    <nav aria-label="Menu" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={cn("rail-menu fixed left-3 top-1/2 z-40 hidden max-h-[calc(100vh-1.5rem)] -translate-y-1/2 flex-col gap-1 overflow-y-auto overflow-x-hidden bg-foreground p-1.5 text-background shadow-xl transition-[width,border-radius] duration-300 ease-out md:flex",
        expanded ? "w-64 rounded-3xl" : "w-[3.25rem] rounded-full")}>
      <button type="button" onClick={openMenuSearch} className={cn(row, "text-background/70 hover:bg-background/15 hover:text-background")} title="Buscar (Ctrl+K)">
        <Search className="h-4 w-4 shrink-0" /><span className={label}>Buscar</span>{expanded && <span className="ml-auto text-[10px] text-background/50">Ctrl K</span>}
      </button>
      <span className="mx-auto my-0.5 h-px w-6 shrink-0 bg-background/15" />
      {modules.map((g) => {
        const tone = worstTone(g.items.map((i) => badges[i.url]));
        const isOpen = expanded && openLabel === g.label;
        const isCur = g.label === currentMod;
        return (
          <div key={g.label} className="w-full">
            <button type="button" aria-expanded={isOpen}
              onClick={() => setOpenMod(openLabel === g.label ? null : g.label)}
              className={cn(row, "relative", isCur ? "bg-background text-foreground" : "text-background/75 hover:bg-background/15 hover:text-background")}>
              <g.icon className="h-4 w-4 shrink-0" />
              <span className={cn(label, "font-medium")}>{g.label}</span>
              {tone && <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(tone), expanded ? "ml-auto" : "absolute right-2 top-2 ring-2 ring-foreground")} />}
            </button>
            {isOpen && (
              <div className="menu-sub ml-5 mt-0.5 grid gap-px border-l border-background/15 pl-2">
                {g.overview && (
                  <Link to={g.overview as never} className={cn("rounded-full px-3 py-1.5 text-[13px] transition-colors", current === g.overview ? "bg-background/20 font-semibold text-background" : "text-background/70 hover:bg-background/10 hover:text-background")}>Visão geral</Link>
                )}
                {g.items.map((i, k) => {
                  const b = badges[i.url];
                  return (
                    <Link key={i.url} to={i.to ?? i.url} style={{ animationDelay: `${Math.min(k, 12) * 25}ms` }}
                      className={cn("menu-stagger flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] transition-colors", current === i.url ? "bg-background/20 font-semibold text-background" : "text-background/70 hover:bg-background/10 hover:text-background")}>
                      <span className="truncate">{i.title}</span>
                      {b && <BadgePill b={b} className="ml-auto" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <span className="mx-auto my-0.5 h-px w-6 shrink-0 bg-background/15" />
      <Popover open={settings} onOpenChange={setSettings}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(row, "relative", settings ? "bg-background text-foreground" : "text-background/75 hover:bg-background/15 hover:text-background")}>
            <Settings className="h-4 w-4 shrink-0" /><span className={label}>Configurações</span>
            {adminItems.some(({ item }) => badges[item.url]) && <span className={cn("h-2 w-2 shrink-0 rounded-full bg-destructive", expanded ? "ml-auto" : "absolute right-2 top-2 ring-2 ring-foreground")} />}
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={14} className="w-64 rounded-2xl p-1.5">
          <div className="px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
            <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[role]}</p>
          </div>
          {adminItems.length > 0 && (
            <>
              <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Administração</p>
              {adminItems.map(({ item, group }) => {
                const Icon = item.icon ?? group.icon;
                return (
                  <Link key={item.url} to={item.to ?? item.url} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent", current === item.url && "bg-accent font-semibold")}>
                    <Icon className="h-4 w-4 text-muted-foreground" /> {item.title}
                    {badges[item.url] && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                  </Link>
                );
              })}
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <Link to="/notificacoes" search={{ aba: "preferencias" } as never} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent"><Bell className="h-4 w-4 text-muted-foreground" /> Notificações</Link>
          <button type="button" onClick={() => setStyle("modern")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent"><LayoutList className="h-4 w-4 text-muted-foreground" /> Usar menu lateral</button>
        </PopoverContent>
      </Popover>
    </nav>
  );
}

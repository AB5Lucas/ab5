/**
 * Menu flutuante (estilo do vídeo de referência): faixa escura arredondada presa à esquerda, só com ícones dos
 * módulos; passar o mouse mostra o nome, clicar abre o quadro com as páginas (módulo com visão geral também abre a visão geral).
 * Sem logo e sem botão de estender; o último botão é Configurações (usuário, Administração, Notificações, Buscar
 * e a troca para o menu lateral). No celular vira uma barra embaixo.
 */
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, Building2, ChevronDown, LayoutList, Search, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { CountUp } from "@/components/count-up";
import { useCompanyRole } from "@/hooks/use-company-role";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MENU_GROUPS, menuUrlFor } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useCurrentUser, ROLE_LABEL } from "@/hooks/use-auth";
import { BadgePill, openMenuSearch, useMenuStyle, worstTone } from "@/components/nav/menu-prefs";
import { cn } from "@/lib/utils";

const dotClass = (tone: string) => (tone === "red" ? "bg-destructive" : "bg-warning");
/** Vidro (como o iOS): fundo translúcido com desfoque e saturação, borda clara e sombra suave. */
const GLASS = "liquid-glass text-foreground";
const GLASS_POP = "liquid-glass liquid-glass-strong";
const ACTIVE = "bg-white/95 text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-white/15";
const IDLE = "text-foreground/70 hover:bg-white/50 hover:text-foreground dark:hover:bg-white/10";

function RailButton({ label, active, children, onClick, dot }: { label: string; active?: boolean; children: React.ReactNode; onClick?: () => void; dot?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-label={label}
          className={cn("rail-btn relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
            active ? ACTIVE : IDLE)}>
          {children}
          {dot && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white/70", dotClass(dot))} />}
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
  const navigateM = useNavigate();
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
      className={cn("fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-row gap-1 overflow-x-auto rounded-full p-1.5 md:hidden", GLASS)}>
      <RailButton label="Buscar (Ctrl+K)" onClick={openMenuSearch}><Search className="h-4 w-4" /></RailButton>
      <span className="mx-1 my-0.5 shrink-0 bg-foreground/10 md:h-px md:w-6 h-6 w-px self-center" />
      {modules.map((g) => {
        const tone = worstTone(g.items.map((i) => badges[i.url]));
        return (
          <Popover key={g.label} open={open === g.label} onOpenChange={(o) => { setOpen(o ? g.label : null); if (o && g.overview) void navigateM({ to: g.overview as never }); }}>
            <PopoverTrigger asChild>
              <span><RailButton label={g.label} active={open ? open === g.label : g.label === currentMod} dot={tone}><g.icon className="h-4 w-4" /></RailButton></span>
            </PopoverTrigger>
            <PopoverContent side="right" align="center" sideOffset={14} className={cn("rail-pop w-60 rounded-2xl p-1.5", GLASS_POP)}>
              <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.label}</p>
              <div className="grid gap-px">
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
      <span className="mx-1 my-0.5 shrink-0 bg-foreground/10 md:h-px md:w-6 h-6 w-px self-center" />
      <Popover open={open === "__settings"} onOpenChange={(o) => setOpen(o ? "__settings" : null)}>
        <PopoverTrigger asChild>
          <span><RailButton label="Configurações" active={open === "__settings"} dot={adminItems.some(({ item }) => badges[item.url]) ? "red" : null}><Settings className="h-4 w-4" /></RailButton></span>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={14} className={cn("rail-pop w-64 rounded-2xl p-1.5", GLASS_POP)}>
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
type Badges = ReturnType<typeof useMenuBadges>;

/** Soma dos avisos das páginas do módulo (texto discreto à direita, como o "22,5°" do modelo). */
function moduleInfo(g: Group, badges: Badges) {
  const n = g.items.reduce((a, i) => a + (badges[i.url]?.count ?? 0), 0);
  return n ? `${n} aviso${n > 1 ? "s" : ""}` : "";
}

/** Prévia de Atividades ao passar o mouse: faturado no mês + barras dos últimos 6 meses (mesma leitura da visão geral). */
function useActivitiesPreview(enabled: boolean) {
  return useQuery({
    queryKey: ["rail-preview", "atividades"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
      const rows = await fetchAll<{ entry_date: string; amount: number }>((a, b) => supabase.from("work_entries").select("entry_date, amount")
        .eq("category", "faturamento").eq("sync_cancelled", false).gte("entry_date", from).order("id").range(a, b));
      const months: string[] = [];
      for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
      const by = new Map(months.map((m) => [m, 0]));
      for (const r of rows) { const m = String(r.entry_date).slice(0, 7); if (by.has(m)) by.set(m, by.get(m)! + Number(r.amount ?? 0)); }
      return months.map((m) => ({ m, v: by.get(m)! }));
    },
  });
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function ActivitiesPreview() {
  const q = useActivitiesPreview(true);
  const [hov, setHov] = useState<number | null>(null);
  const data = q.data ?? [];
  const cur = data[data.length - 1]?.v ?? 0, prev = data[data.length - 2]?.v ?? 0;
  const delta = prev ? ((cur - prev) / prev) * 100 : null;
  const max = Math.max(1, ...data.map((d) => d.v));
  const sel = hov ?? data.length - 1;
  const short = (v: number) => v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return (
    <div className="rail-preview w-64 rounded-3xl bg-neutral-950 p-4 text-white shadow-2xl">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10"><Building2 className="h-3.5 w-3.5" /></span>
        <div>
          <p className="text-sm font-medium leading-tight">Faturado no mês</p>
          {delta != null && <p className="text-[10px] text-white/60">{delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs. mês anterior</p>}
        </div>
      </div>
      <p className="mt-3 font-display text-4xl font-light tracking-tight">{q.isLoading ? "…" : <CountUp value={`R$ ${short(cur)}`} />}</p>
      <div className="relative mt-3 flex h-16 items-end gap-1.5" onMouseLeave={() => setHov(null)}>
        {data.map((d, k) => (
          <div key={d.m} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHov(k)}>
            <div className={cn("ov-grow w-full rounded-md", k === sel ? "bg-primary" : "bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.28)_0_2px,transparent_2px_5px)]")}
              style={{ height: `${Math.max(6, (d.v / max) * 100)}%`, animationDelay: `${k * 50}ms` }} />
            {k === sel && <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-900">{MONTHS[Number(d.m.slice(5, 7)) - 1]} · {short(d.v)}</span>}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-white/45">{data.map((d) => <span key={d.m}>{MONTHS[Number(d.m.slice(5, 7)) - 1]}</span>)}</div>
    </div>
  );
}

/**
 * Computador (modelo do vídeo "Nido"): painel de vidro arredondado, compacto só com ícones; ao passar o mouse abre com
 * busca, módulos (ativo em pílula escura com o ícone num círculo da cor da marca, avisos à direita), páginas do módulo
 * aberto com bolinha, prévia escura ao lado (Atividades) e Configurações fixa embaixo.
 */
function DesktopRail({ modules, adminItems, current, currentMod, badges }: {
  modules: Group[]; adminItems: { item: Group["items"][number]; group: Group }[]; current: string; currentMod: string | null; badges: Badges;
}) {
  const { profile, role } = useCurrentUser();
  const companyRole = useCompanyRole();
  const [, setStyle] = useMenuStyle();
  const navigate = useNavigate();
  const [openMod, setOpenMod] = useState<string | null | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<{ label: string; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const enter = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(true), 90); };
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { setHover(false); setPreview(null); }, 240); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { setOpenMod(undefined); setSettings(false); setPreview(null); }, [current]);
  const openLabel = openMod === undefined ? currentMod : openMod;
  const expanded = hover || settings;
  const highlighted = expanded && openLabel ? openLabel : currentMod;
  const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";
  // Fechado: textos sem largura (não empurram nada) e o ícone centralizado num círculo do tamanho da faixa.
  const fade = cn("whitespace-nowrap transition-[opacity,transform] duration-300", expanded ? "translate-x-0 opacity-100 delay-100" : "pointer-events-none w-0 -translate-x-1 overflow-hidden opacity-0");
  const rowBase = cn("group/row relative flex h-10 items-center rounded-full text-sm transition-[background-color,color,box-shadow,width,padding] duration-300",
    expanded ? "w-full gap-3 pl-0.5 pr-3" : "mx-auto w-10 justify-center gap-0 px-0");
  const iconWrap = (active: boolean) => cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
    active ? "text-foreground" : "text-foreground/70 group-hover/row:text-foreground");
  const initials = (profile?.full_name || profile?.email || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div onMouseEnter={enter} onMouseLeave={leave} className="fixed left-3 top-1/2 z-40 hidden -translate-y-1/2 md:block">
      <nav aria-label="Menu"
        className={cn("rail-menu relative flex max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[28px] p-[7px] transition-[width,box-shadow] duration-500", ease, GLASS, expanded ? "w-[15.75rem]" : "w-[3.5rem]")}>
        {/* Logo e a pessoa (nome e função na empresa) */}
        <div className={cn("mb-1.5 flex h-11 items-center transition-[padding,gap] duration-300", expanded ? "gap-2.5 pl-0.5 pr-2" : "justify-center gap-0")}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white to-neutral-200 text-[11px] font-semibold text-neutral-700 shadow-sm dark:from-neutral-700 dark:to-neutral-800 dark:text-white">HUB</span></span>
          <span className={cn(fade, "min-w-0 leading-tight", !expanded && "hidden")}>
            <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide">AB5 HUB</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">Sistema de Gestão Corporativo</span>
          </span>
        </div>
        {/* Busca */}
        <button type="button" onClick={openMenuSearch} title="Buscar (Ctrl+K)"
          className={cn("mb-1 flex h-10 items-center rounded-full text-sm transition-[background-color,width,padding] duration-300", expanded ? "w-full gap-2 bg-white/60 pl-3 pr-2 text-muted-foreground shadow-inner dark:bg-white/10" : "mx-auto w-10 justify-center text-foreground/70 hover:bg-white/50")}>
          <Search className="h-4 w-4 shrink-0" />
          {expanded && <span className={cn(fade, "flex-1 text-left text-[13px]")}>Buscar página…</span>}
          {expanded && <kbd className={cn(fade, "rounded-md border border-foreground/10 bg-white/70 px-1.5 text-[10px] text-muted-foreground dark:bg-white/10")}>Ctrl K</kbd>}
        </button>

        {/* Módulos (rolam; a lista some suavemente embaixo) */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [mask-image:linear-gradient(to_bottom,black_88%,transparent)] [scrollbar-width:none]">
          <div className="space-y-0.5 pb-6">
            {modules.map((g) => {
              const tone = worstTone(g.items.map((i) => badges[i.url]));
              const isOpen = expanded && openLabel === g.label;
              const active = g.label === highlighted;
              const info = moduleInfo(g, badges);
              return (
                <div key={g.label}>
                  <button type="button" aria-expanded={isOpen}
                    onMouseEnter={(e) => { if (g.overview && expanded) setPreview({ label: g.label, top: (e.currentTarget as HTMLElement).getBoundingClientRect().top }); else setPreview(null); }}
                    onClick={() => { const opening = openLabel !== g.label; setOpenMod(opening ? g.label : null); if (opening && g.overview) void navigate({ to: g.overview as never }); }}
                    className={cn(rowBase, active ? "bg-foreground/[0.09] font-semibold text-foreground dark:bg-white/15" : "text-foreground/80 hover:bg-white/70 hover:shadow-sm dark:hover:bg-white/10")}>
                    <span className={iconWrap(active)}><g.icon className="h-4 w-4" /></span>
                    <span className={cn(fade, expanded && "flex-1", "truncate text-left font-medium")}>{g.label}</span>
                    {info && <span className={cn(fade, "text-[10.5px]", active ? "text-foreground/60" : "text-muted-foreground")}>{info}</span>}
                    {expanded && <ChevronDown className={cn(fade, "h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-300", isOpen && "rotate-180")} />}
                    {tone && !expanded && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white/80", dotClass(tone))} />}
                  </button>
                  <div className={cn("grid transition-[grid-template-rows,opacity] duration-500", ease, isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="ml-2 mt-0.5 space-y-px py-0.5 pl-1">
                        {g.items.map((i) => {
                          const b = badges[i.url];
                          return (
                            <Link key={i.url} to={i.to ?? i.url}
                              className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors duration-300", current === i.url ? "bg-white/90 font-semibold text-foreground shadow-sm dark:bg-white/15" : "text-foreground/70 hover:bg-white/60 hover:text-foreground dark:hover:bg-white/10")}>
                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", b ? dotClass(b.tone) : "bg-foreground/25")} />
                              <span className="truncate">{i.title}</span>
                              {b && <span className="ml-auto text-[10.5px] text-muted-foreground">{b.label ?? b.count}</span>}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Configurações, sempre embaixo */}
        <Popover open={settings} onOpenChange={setSettings}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(rowBase, "mt-1", settings ? "bg-white/80 shadow-sm dark:bg-white/15" : "text-foreground/80 hover:bg-white/70 dark:hover:bg-white/10")}>
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white to-neutral-200 text-[11px] font-semibold text-neutral-700 shadow-sm dark:from-neutral-700 dark:to-neutral-800 dark:text-white">
                {initials}
                {adminItems.some(({ item }) => badges[item.url]) && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-white/80" />}
              </span>
              <span className={cn(fade, expanded && "flex-1", "min-w-0 text-left leading-tight")}>
                <span className="block truncate text-[13px] font-medium">{profile?.full_name || profile?.email}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">{companyRole || ROLE_LABEL[role]}</span>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" sideOffset={14} className={cn("w-64 rounded-2xl p-1.5", GLASS_POP)}>
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
                    <Link key={item.url} to={item.to ?? item.url} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/60 dark:hover:bg-white/10", current === item.url && "bg-white/70 font-semibold")}>
                      <Icon className="h-4 w-4 text-muted-foreground" /> {item.title}
                      {badges[item.url] && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                    </Link>
                  );
                })}
                <div className="my-1 h-px bg-foreground/10" />
              </>
            )}
            <Link to="/notificacoes" search={{ aba: "preferencias" } as never} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/60 dark:hover:bg-white/10"><Bell className="h-4 w-4 text-muted-foreground" /> Notificações</Link>
            <button type="button" onClick={() => setStyle("modern")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/60 dark:hover:bg-white/10"><LayoutList className="h-4 w-4 text-muted-foreground" /> Usar menu lateral</button>
          </PopoverContent>
        </Popover>
      </nav>

      {/* Prévia escura do módulo (Atividades), ao lado da linha em que o mouse está */}
      {expanded && preview && (
        <div className="absolute left-[calc(100%+0.75rem)]" style={{ top: Math.max(8, preview.top - (document.querySelector(".rail-menu")?.getBoundingClientRect().top ?? 0) - 8) }}
          onMouseEnter={enter}>
          {preview.label === "Atividades" && <ActivitiesPreview />}
        </div>
      )}
    </div>
  );
}

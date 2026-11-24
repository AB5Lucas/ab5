import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useMarkRead, useNotificationsRealtime, useRecentNotifications } from "@/hooks/use-notifications";
import { NotificationRow } from "@/components/notifications/notification-row";
import { BadgePill, badgeText, worstTone } from "./menu-prefs";

/**
 * Sino do topo: Notificações (pessoais, ao vivo) e Avisos do menu (cada um leva à página).
 * O número em azul = notificações não lidas; a bolinha colorida = avisos do menu.
 */
export function NotificationsBell({ showMenuAlerts = true }: { showMenuAlerts?: boolean }) {
  const [open, setOpen] = useState(false);
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  useNotificationsRealtime();
  const recent = useRecentNotifications(20);
  const markRead = useMarkRead();
  const unread = recent.data?.unread ?? 0;
  const notifs = recent.data?.items ?? [];
  const items = !showMenuAlerts || loading ? [] : MENU_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })))
    .filter((i) => badges[i.url] && canAccess(i.url))
    .sort((a, b) => Number(badges[b.url]!.tone === "red") - Number(badges[a.url]!.tone === "red"));
  const tone = worstTone(items.map((i) => badges[i.url]));
  const [tab, setTab] = useState<string>("notificacoes");
  const label = [unread ? `${unread} notificação(ões) não lida(s)` : null, items.length ? `${items.length} aviso(s)` : null].filter(Boolean).join(", ") || "Sem notificações";
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTab(unread || !items.length ? "notificacoes" : "avisos"); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={label} title="Notificações e avisos">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-[4px] bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          {tone && (unread > 0 ? (
            <span className={`absolute left-1 top-1 h-2 w-2 rounded-full ${tone === "red" ? "bg-destructive" : "bg-warning"}`} />
          ) : (
            <span className={`absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-[4px] px-0.5 text-[9px] font-semibold leading-none ${tone === "red" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"}`}>
              {items.length}
            </span>
          ))}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <TabsList className="h-8">
              <TabsTrigger value="notificacoes" className="text-xs">Notificações{unread ? ` (${unread})` : ""}</TabsTrigger>
              {showMenuAlerts && <TabsTrigger value="avisos" className="text-xs">Avisos{items.length ? ` (${items.length})` : ""}</TabsTrigger>}
            </TabsList>
            <Link to="/notificacoes" search={{ aba: "preferencias" }} onClick={() => setOpen(false)} title="Preferências de notificação" aria-label="Preferências de notificação"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <Settings className="h-4 w-4" />
            </Link>
          </div>
          <TabsContent value="notificacoes" className="mt-0">
            {unread > 0 && (
              <div className="flex justify-end border-b border-border px-3 py-1">
                <button type="button" onClick={() => markRead.mutate("all")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
                </button>
              </div>
            )}
            {!notifs.length ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{recent.isLoading ? "Carregando…" : "Nenhuma notificação."}</p>
            ) : (
              <div className="max-h-96 divide-y divide-border overflow-y-auto">
                {notifs.map((n) => <NotificationRow key={n.id} n={n} compact onRead={(id) => markRead.mutate([id])} onOpen={() => setOpen(false)} />)}
              </div>
            )}
            <div className="border-t border-border px-3 py-2 text-center">
              <Link to="/notificacoes" onClick={() => setOpen(false)} className="text-xs font-medium text-primary hover:underline">Ver todas</Link>
            </div>
          </TabsContent>
          {showMenuAlerts && (
            <TabsContent value="avisos" className="mt-0">
              <p className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">Vermelho: exige ação ou vencido · Laranja: atenção, a vencer · !: alerta de valor</p>
              {!items.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum aviso. Tudo em dia.</p>
              ) : (
                <ul className="max-h-96 overflow-y-auto py-1">
                  {items.map((i) => {
                    const b = badges[i.url]!;
                    const Icon = i.icon ?? i.group.icon;
                    return (
                      <li key={i.url}>
                        <Link to={i.to ?? i.url} onClick={() => setOpen(false)} className="flex items-start gap-3 px-3 py-2 hover:bg-accent">
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${b.tone === "red" ? "bg-destructive/15 text-destructive" : "bg-warning/20 text-orange-600 dark:text-orange-400"}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-sm font-medium">{i.title}<span className="text-[11px] font-normal text-muted-foreground">{i.group.label}</span></span>
                            <span className="block text-xs text-muted-foreground">{badgeText(b)}</span>
                          </span>
                          <BadgePill b={b} className="mt-1" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          )}
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

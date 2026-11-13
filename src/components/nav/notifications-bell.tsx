import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { BadgePill, badgeText, worstTone } from "./menu-prefs";

/** Sino do topo: todos os avisos do menu num lugar só; cada um leva à página. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const items = loading ? [] : MENU_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })))
    .filter((i) => badges[i.url] && canAccess(i.url))
    .sort((a, b) => Number(badges[b.url]!.tone === "red") - Number(badges[a.url]!.tone === "red"));
  const tone = worstTone(items.map((i) => badges[i.url]));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={items.length ? `${items.length} aviso(s)` : "Sem avisos"} title="Avisos">
          <Bell className="h-4 w-4" />
          {tone && (
            <span className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ${tone === "red" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"}`}>
              {items.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Avisos</p>
          <p className="text-[11px] text-muted-foreground">Vermelho: exige ação ou vencido · Laranja: atenção, a vencer · !: alerta de valor</p>
        </div>
        {!items.length ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum aviso. Tudo em dia.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((i) => {
              const b = badges[i.url]!;
              const Icon = i.icon ?? i.group.icon;
              return (
                <li key={i.url}>
                  <Link to={i.url} onClick={() => setOpen(false)} className="flex items-start gap-3 px-3 py-2 hover:bg-accent">
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
      </PopoverContent>
    </Popover>
  );
}

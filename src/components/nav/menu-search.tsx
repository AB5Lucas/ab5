import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { MENU_GROUPS } from "@/lib/menu";
import { useAccess } from "@/hooks/use-access";
import { useMenuBadges } from "@/hooks/use-nav-badges";
import { useCurrentUser } from "@/hooks/use-auth";
import { BadgePill, useFavorites } from "./menu-prefs";

/** Busca rápida de páginas (Ctrl+K / ⌘K): digite parte do nome e Enter. */
export function MenuSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { canAccess, loading } = useAccess();
  const badges = useMenuBadges();
  const { user } = useCurrentUser();
  const { favs } = useFavorites(user?.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-menu-search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-menu-search", onOpen); };
  }, []);
  const groups = loading ? [] : MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.url)) })).filter((g) => g.items.length);
  const go = (url: string) => { setOpen(false); navigate({ to: url }); };
  const favItems = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g }))).filter((i) => favs.includes(i.url));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar página... (ex.: abast, ponto, compras)" />
      <CommandList>
        <CommandEmpty>Nenhuma página encontrada.</CommandEmpty>
        {favItems.length > 0 && (
          <CommandGroup heading="Favoritos">
            {favItems.map((i) => {
              const Icon = i.icon ?? i.group.icon;
              return (
                <CommandItem key={`fav-${i.url}`} value={`favorito ${i.title} ${i.group.label}`} onSelect={() => go(i.url)}>
                  <Icon className="h-4 w-4" /> {i.title}
                  <Star className="ml-1 h-3 w-3 fill-current text-warning" />
                  {badges[i.url] && <BadgePill b={badges[i.url]!} className="ml-auto" />}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {groups.map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((i) => {
              const Icon = i.icon ?? g.icon;
              return (
                <CommandItem key={i.url} value={`${i.title} ${g.label}`} onSelect={() => go(i.url)}>
                  <Icon className="h-4 w-4" /> {i.title}
                  {badges[i.url] ? <BadgePill b={badges[i.url]!} className="ml-auto" /> : <CommandShortcut>{g.label}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

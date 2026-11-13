import { useCallback, useEffect, useState } from "react";
import type { MenuBadge } from "@/hooks/use-nav-badges";

/**
 * Preferências do menu guardadas neste navegador: estilo (novo ou clássico) e páginas favoritas.
 * O menu clássico continua disponível para voltar atrás a qualquer momento.
 */
export type MenuStyle = "modern" | "classic";
const STYLE_KEY = "menu-style";
const FAV_KEY = (uid: string | undefined) => `menu-favorites:${uid ?? "anon"}`;
const EVENT = "menu-prefs";

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignora */ }
  window.dispatchEvent(new Event(EVENT));
};

function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    const sync = () => setValue(read(key, fallback));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, useCallback((v: T) => write(key, v), [key])];
}

export const useMenuStyle = () => useStored<MenuStyle>(STYLE_KEY, "modern");

export function useFavorites(uid: string | undefined) {
  const [favs, setFavs] = useStored<string[]>(FAV_KEY(uid), []);
  const toggle = (url: string) => setFavs(favs.includes(url) ? favs.filter((u) => u !== url) : [...favs, url].slice(-8));
  return { favs, toggle, isFav: (url: string) => favs.includes(url) };
}

/** Texto do aviso para o mouse e para o sino. */
export const badgeText = (b: MenuBadge) => b.detail || b.title || (b.tone === "red" ? "Vencidos ou pendentes" : "A vencer");
/** Pior aviso de uma lista (vermelho ganha do laranja). */
export const worstTone = (list: (MenuBadge | undefined)[]) =>
  list.some((b) => b?.tone === "red") ? "red" : list.some((b) => b?.tone === "orange") ? "orange" : null;

export function BadgePill({ b, className = "" }: { b: MenuBadge; className?: string }) {
  return (
    <span title={badgeText(b)}
      className={`min-w-5 rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px] tabular-nums shadow-sm ${b.tone === "red" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"} ${className}`}>
      {b.label ?? (b.count > 99 ? "99+" : b.count)}
    </span>
  );
}

/** Abre a busca rápida (Ctrl+K) de qualquer lugar. */
export const openMenuSearch = () => window.dispatchEvent(new Event("open-menu-search"));

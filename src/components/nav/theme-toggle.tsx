import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "theme";

/** Lê o tema salvo no navegador (claro por padrão). */
function savedDark(): boolean {
  try { return localStorage.getItem(KEY) === "dark"; } catch { return false; }
}

/** Script curto no <head> que aplica o tema antes de a página aparecer (sem piscar claro → escuro). */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

/** Botão do cabeçalho que alterna modo claro/escuro (por navegador). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(savedDark()); }, []);
  const apply = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* sem armazenamento: vale só nesta aba */ }
  };
  // O tema novo cresce em círculo a partir do botão até cobrir a página (View Transitions; sem suporte, troca direto).
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const next = !dark;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) { apply(next); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(() => { flushSync(() => apply(next)); });
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 550, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => { /* animação cancelada: o tema já foi trocado */ });
  };
  return (
    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={toggle}
      title={dark ? "Usar modo claro" : "Usar modo escuro"} aria-label={dark ? "Usar modo claro" : "Usar modo escuro"}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

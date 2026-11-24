import { useEffect, useState } from "react";
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
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* sem armazenamento: vale só nesta aba */ }
  };
  return (
    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={toggle}
      title={dark ? "Usar modo claro" : "Usar modo escuro"} aria-label={dark ? "Usar modo claro" : "Usar modo escuro"}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

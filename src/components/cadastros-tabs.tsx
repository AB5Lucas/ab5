import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { pageTabsStore, usePageTabs } from "@/lib/page-tabs-store";

const ITEMS = [
  { value: "clientes", label: "Clientes", to: "/clientes" },
  { value: "servicos", label: "Serviços", to: "/obras" },
] as const;

/**
 * Abas de Serviços → Clientes: Clientes e Serviços (cada uma é uma rota). Entram no menu lateral como as subabas das
 * outras páginas; com o menu estendido, a fileira de abas some da página.
 */
export function CadastrosTabs({ active }: { active: "servicos" | "clientes" }) {
  const navigate = useNavigate();
  const { menuExtended } = usePageTabs();
  useEffect(() => {
    pageTabsStore.set({
      items: ITEMS.map(({ value, label }) => ({ value, label })),
      value: active,
      setValue: (v) => { const to = ITEMS.find((i) => i.value === v)?.to; if (to) navigate({ to }); },
    });
    return () => pageTabsStore.set({ items: [], value: null, setValue: null });
  }, [active, navigate]);
  if (menuExtended) return null;
  const cls = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="inline-flex rounded-lg bg-muted p-1">
      {ITEMS.map((i) => <Link key={i.value} to={i.to} className={cls(active === i.value)}>{i.label}</Link>)}
    </div>
  );
}

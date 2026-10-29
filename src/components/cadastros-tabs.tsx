import { Link } from "@tanstack/react-router";

/** Abas de Obras → Cadastros: Serviços e Clientes. */
export function CadastrosTabs({ active }: { active: "servicos" | "clientes" }) {
  const cls = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="inline-flex rounded-lg bg-muted p-1">
      <Link to="/obras" className={cls(active === "servicos")}>Serviços</Link>
      <Link to="/clientes" className={cls(active === "clientes")}>Clientes</Link>
    </div>
  );
}

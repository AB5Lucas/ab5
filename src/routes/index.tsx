import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-auth";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AB5 Hub | Plataforma Integrada de Gestão" },
      {
        name: "description",
        content: "AB5 Hub: operações, obras, equipes e resultados da AB5 reunidos em uma única plataforma.",
      },
      { property: "og:title", content: "AB5 Hub | Plataforma Integrada de Gestão" },
      { property: "og:description", content: "Operações, obras, equipes e resultados da AB5 em um só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-secondary">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={ab5Logo.url} alt="AB5" className="h-10 w-10 object-contain" />
          <span className="font-display text-sm font-semibold uppercase tracking-widest">AB5 Hub</span>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6 pb-20">
        <section className="panel w-full p-10 md:p-16">
          <img src={ab5Logo.url} alt="AB5" className="h-20 w-20 object-contain" />
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-primary">Plataforma Integrada de Gestão</p>
          <h1 className="mt-3 font-display text-5xl font-semibold uppercase leading-tight tracking-wide md:text-7xl">
            AB5 Hub
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Operações, obras, equipes e resultados reunidos em um só lugar.
          </p>
          <Button asChild size="lg" className="mt-10">
            <Link to="/auth">
              Acessar o sistema <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </section>
      </main>

      <footer className="pb-6 text-center text-xs text-muted-foreground">AB5 · Acesso restrito à equipe</footer>
    </div>
  );
}

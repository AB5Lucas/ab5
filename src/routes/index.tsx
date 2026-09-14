import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { HardHat, CalendarRange, Users, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Programação Operacional Integrada | Obras e Equipes" },
      {
        name: "description",
        content:
          "Sistema de programação operacional: equipes-base por obra, programação diária, ausências, frota e benefícios em um só lugar.",
      },
      { property: "og:title", content: "Programação Operacional Integrada" },
      {
        property: "og:description",
        content: "Programe colaboradores em obras todos os dias com validação automática de requisitos.",
      },
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
    <div className="min-h-screen bg-secondary">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <HardHat className="h-5 w-5" />
          </span>
          <span className="font-display text-sm uppercase tracking-widest">Programação Operacional</span>
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20">
        <section className="panel p-8 md:p-12">
          <h1 className="max-w-3xl font-display text-4xl font-semibold uppercase leading-tight tracking-wide md:text-5xl">
            Programe suas equipes em obras todos os dias, sem retrabalho
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Equipe-base por obra, programação diária independente do histórico, validação automática de
            férias, atestados, folgas e treinamentos, designação de veículos e cálculo de benefícios.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Acessar o sistema</Link>
            </Button>
          </div>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { icon: CalendarRange, title: "Programação diária", text: "Copie o dia útil anterior ou parta da equipe-base, sempre com validação." },
            { icon: Users, title: "Equipes-base", text: "A equipe padrão da obra permanece intacta mesmo com trocas diárias." },
            { icon: Truck, title: "Transporte e benefícios", text: "Veículos, motoristas, vale-transporte e prêmio de viagem integrados." },
          ].map((f) => (
            <div key={f.title} className="panel p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-3 font-display text-base uppercase tracking-wide">{f.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

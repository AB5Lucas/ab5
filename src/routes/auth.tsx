import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { HardHat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acesso ao Sistema | Programação Operacional" },
      {
        name: "description",
        content:
          "Entre no sistema de programação operacional para gerenciar colaboradores, obras, equipes e transporte.",
      },
      { property: "og:title", content: "Acesso ao Sistema | Programação Operacional" },
      {
        property: "og:description",
        content: "Login do sistema integrado de programação operacional de obras e equipes.",
      },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("E-mail inválido").max(255);
const passwordSchema = z.string().min(6, "A senha deve ter ao menos 6 caracteres").max(72);

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar: " + error.message);
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({ email: emailSchema, password: passwordSchema, fullName: z.string().trim().min(3, "Informe o nome completo").max(120) })
      .safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: parsed.data.fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível cadastrar: " + error.message);
      return;
    }
    if (data.session) {
      navigate({ to: "/dashboard" });
      return;
    }
    toast.success("Cadastro criado. Confirme o e-mail para acessar o sistema.");
  }

  async function handleReset() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Informe um e-mail válido para recuperar a senha");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Enviamos um link de recuperação para o seu e-mail.");
  }


  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4 py-10">
      <div className="panel w-full max-w-md p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <HardHat className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold uppercase tracking-wide">
              Programação Operacional
            </h1>
            <p className="text-xs text-muted-foreground">Acesso restrito à equipe</p>
          </div>
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
              <button type="button" onClick={handleReset} className="w-full text-xs text-muted-foreground underline">
                Esqueci minha senha
              </button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-up">E-mail</Label>
                <Input id="email-up" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password-up">Senha</Label>
                <Input id="password-up" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Cadastrando..." : "Criar conta"}
              </Button>
              <p className="text-xs text-muted-foreground">
                O primeiro usuário cadastrado recebe o perfil Administrador. Os demais entram como
                Consulta até que um administrador altere o perfil.
              </p>
            </form>
          </TabsContent>
        </Tabs>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/">Voltar à página inicial</Link>
        </p>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { SearchSelect } from "@/components/search-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ForemanWorksButton } from "@/components/foreman-works-dialog";
import { MENU_GROUPS } from "@/lib/menu";
import { useCurrentUser, ROLE_LABEL, type AppRole } from "@/hooks/use-auth";
import { defaultAllowed } from "@/hooks/use-access";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/acessos")({
  head: () => ({
    meta: [
      { title: "Acessos | AB5 Hub" },
      { name: "description", content: "Páginas liberadas para cada pessoa." },
      { property: "og:title", content: "Acessos | AB5 Hub" },
      { property: "og:description", content: "Permissões de acesso por pessoa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({ user: typeof s["user"] === "string" ? (s["user"] as string) : undefined }),
  component: AccessPage,
});

type Person = { id: string; full_name: string; email: string; active: boolean; pending: boolean; role: AppRole };
const MODULES = MENU_GROUPS.map((g) => ({ label: g.label, icon: g.icon, items: g.items }));
const ALL_PATHS = MODULES.flatMap((m) => m.items.map((i) => i.url));
/** Marcações individuais que não são páginas (gravadas em user_page_access com "@"). */
const FLAGS = [
  { path: "@salario", title: "Ver e editar salário (Colaboradores)" },
  { path: "@aviso-contratacoes", title: "Receber o aviso de Contratações" },
];
const FLAG_PATHS = FLAGS.map((f) => f.path);

function pickRole(list: AppRole[]): AppRole {
  for (const r of ["admin", "programmer", "coordenador", "encarregado", "cliente"] as AppRole[]) if (list.includes(r)) return r;
  return "viewer";
}

/** Contador do módulo: Todas / x de y / —. */
function ModPill({ on, total }: { on: number; total: number }) {
  const cls = on === total ? "bg-success/15 text-success" : on ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", cls)}>{on === total ? "Todas" : on ? `${on}/${total}` : "—"}</span>;
}

/**
 * Acessos individuais (grupos extintos em 27/11, migração 0197): cada pessoa tem as páginas marcadas nela
 * (user_page_access). Sem marcação vale o padrão do perfil. O perfil continua sendo só o alcance dos dados.
 */
function AccessPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const people = useQuery({
    queryKey: ["access-people"],
    queryFn: async () => {
      const [{ data: p, error }, { data: roles }] = await Promise.all([
        supabase.from("users_profiles").select("id, full_name, email, active, pending").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (p ?? []).map((u) => ({ ...u, role: pickRole((roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole)) })) as Person[];
    },
  });
  const rolePages = useQuery({
    queryKey: ["role-access"],
    queryFn: async () => (await supabase.from("role_page_access").select("role, path, allowed")).data ?? [],
  });
  const exceptions = useQuery({
    queryKey: ["access-exceptions"],
    // Paginado: a tabela já passa de 1.000 linhas e a leitura simples cortava pessoas (a marcação gravada não aparecia).
    queryFn: async () => fetchAll<{ user_id: string; path: string; allowed: boolean }>((a, b) => supabase.from("user_page_access").select("user_id, path, allowed").in("path", [...ALL_PATHS, ...FLAG_PATHS]).order("id").range(a, b)),
  });
  const invalidate = () => { for (const k of ["access-people", "access-exceptions", "user-access", "my-salary-flag"]) qc.invalidateQueries({ queryKey: [k] }); };

  const exOf = useMemo(() => {
    const m = new Map<string, Map<string, boolean>>();
    for (const r of exceptions.data ?? []) { if (!m.has(r.user_id)) m.set(r.user_id, new Map()); m.get(r.user_id)!.set(r.path, r.allowed); }
    return m;
  }, [exceptions.data]);
  const roleAllows = (role: AppRole, path: string) => {
    const row = (rolePages.data ?? []).find((r) => r.role === role && r.path === path);
    return row ? row.allowed : defaultAllowed(role, path);
  };
  const personAllows = (p: Person, path: string) => {
    if (p.role === "admin") return true;
    const ex = exOf.get(p.id)?.get(path);
    if (FLAG_PATHS.includes(path)) return !!ex;
    return ex ?? roleAllows(p.role, path);
  };
  const people_ = (people.data ?? []).filter((p) => p.active || p.pending);

  const setPage = useMutation({
    mutationFn: async ({ p, paths, allowed }: { p: Person; paths: string[]; allowed: boolean }) => {
      const now = new Date().toISOString();
      const { error } = await supabase.from("user_page_access").upsert(paths.map((path) => ({ user_id: p.id, path, allowed, updated_at: now })), { onConflict: "user_id,path" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Não foi possível salvar: " + e.message),
  });

  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(search.user ?? null);
  const shown = people_.filter((p) => !q.trim() || (p.full_name || p.email).toLowerCase().includes(q.trim().toLowerCase()));
  const person = people_.find((p) => p.id === sel) ?? (people.data ?? []).find((p) => p.id === sel) ?? null;

  if (!isAdmin) return <p className="text-sm text-muted-foreground">Só administradores alteram acessos.</p>;
  return (
    <div className="space-y-4">
      <PageHeader title="Acessos" description="Marque, pessoa a pessoa, as páginas que cada uma acessa. Usuário novo: abra pela tela Usuários (botão Páginas)." />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="panel min-w-0">
          <div className="flex flex-wrap items-end gap-3 p-3">
            <div className="space-y-1">
              <Label htmlFor="acc-q" className="block text-xs">Buscar</Label>
              <div className="relative w-60">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="acc-q" className="pl-8" placeholder="Nome" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow><TableHead>Pessoa</TableHead><TableHead>Alcance</TableHead><TableHead className="text-center">Páginas</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.id} className={cn("cursor-pointer", sel === p.id && "bg-primary/5")} onClick={() => setSel(p.id)}>
                    <TableCell>
                      <div className="font-medium">{p.full_name || p.email}{p.pending && <span className="ml-2 rounded bg-destructive px-1.5 text-xs text-destructive-foreground">novo</span>}</div>
                      <div className="text-xs text-muted-foreground">{p.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ROLE_LABEL[p.role]}</TableCell>
                    <TableCell className="text-center tabular-nums">{p.role === "admin" ? "Todas" : ALL_PATHS.filter((u) => personAllows(p, u)).length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <aside className="panel space-y-3 p-4 xl:sticky xl:top-4">
          {!person ? <p className="text-sm text-muted-foreground">Clique numa pessoa para ver e ajustar o acesso dela.</p> : (
            <>
              <div>
                <div className="text-xs text-muted-foreground">Pessoa</div>
                <div className="font-display text-lg font-semibold uppercase">{person.full_name || person.email}</div>
                <div className="text-xs text-muted-foreground">Alcance: {ROLE_LABEL[person.role]} (perfil em Usuários)</div>
              </div>
              {(person.role === "encarregado" || person.role === "coordenador" || person.role === "cliente") && (
                <ForemanWorksButton userId={person.id} name={person.full_name || person.email} perWork={person.role === "cliente"} />
              )}
              {person.role === "admin" && <p className="rounded-md bg-muted p-2 text-xs">Administrador: acessa tudo.</p>}
              {person.role !== "admin" && (
                // Usuário novo nasce sem páginas: copia as páginas (e marcações @) de alguém com a mesma função, depois ajusta.
                <div className="space-y-1">
                  <Label className="block text-xs">Copiar acessos de</Label>
                  <SearchSelect value="" placeholder="Escolha uma pessoa" searchPlaceholder="Digite o nome"
                    disabled={setPage.isPending}
                    options={people_.filter((x) => x.id !== person.id).map((x) => ({ value: x.id, label: x.full_name || x.email }))}
                    onChange={(id) => {
                      const src = people_.find((x) => x.id === id); if (!src) return;
                      const paths = [...ALL_PATHS, ...FLAG_PATHS];
                      const on = paths.filter((u) => personAllows(src, u)), off = paths.filter((u) => !personAllows(src, u));
                      setPage.mutate({ p: person, paths: on, allowed: true }, {
                        onSuccess: () => setPage.mutate({ p: person, paths: off, allowed: false },
                          { onSuccess: () => toast.success(`Acessos de ${src.full_name || src.email} copiados (${on.filter((u) => !u.startsWith("@")).length} páginas)`) }),
                      });
                    }} />
                  <p className="text-[11px] text-muted-foreground">Substitui todas as páginas desta pessoa pelas da escolhida.</p>
                </div>
              )}
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {MODULES.map((m) => {
                  const on = m.items.filter((i) => personAllows(person, i.url)).length;
                  return (
                    <div key={m.label}>
                      <div className="mb-1 flex items-center justify-between gap-2 border-b border-border pb-1 text-sm font-semibold">
                        <span className="flex items-center gap-1.5"><m.icon className="h-4 w-4" /> {m.label}</span>
                        <span className="flex items-center gap-2">
                          {person.role !== "admin" && (
                            <button type="button" className="text-xs font-normal text-primary hover:underline"
                              onClick={() => setPage.mutate({ p: person, paths: m.items.map((i) => i.url), allowed: on !== m.items.length })}>
                              {on === m.items.length ? "Desmarcar" : "Marcar"} todas
                            </button>
                          )}
                          <ModPill on={on} total={m.items.length} />
                        </span>
                      </div>
                      {m.items.map((i) => (
                        <label key={i.url} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                          <span>{i.title}</span>
                          <Checkbox checked={personAllows(person, i.url)} disabled={person.role === "admin"}
                            onCheckedChange={(v) => setPage.mutate({ p: person, paths: [i.url], allowed: v === true })} />
                        </label>
                      ))}
                    </div>
                  );
                })}
                {person.role !== "admin" && (
                  <div>
                    <div className="mb-1 border-b border-border pb-1 text-sm font-semibold">Outras permissões</div>
                    {FLAGS.map((f) => (
                      <label key={f.path} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                        <span>{f.title}</span>
                        <Checkbox checked={personAllows(person, f.path)} onCheckedChange={(v) => setPage.mutate({ p: person, paths: [f.path], allowed: v === true })} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

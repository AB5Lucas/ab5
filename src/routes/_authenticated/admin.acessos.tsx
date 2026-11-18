import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ForemanWorksButton } from "@/components/foreman-works-dialog";
import { MENU_GROUPS } from "@/lib/menu";
import { useCurrentUser, ROLE_LABEL, type AppRole } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/acessos")({
  head: () => ({
    meta: [
      { title: "Acessos | AB5 Hub" },
      { name: "description", content: "Grupos de acesso por cargo, páginas por módulo e exceções por pessoa." },
      { property: "og:title", content: "Acessos | AB5 Hub" },
      { property: "og:description", content: "Permissões de acesso por grupo e por pessoa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccessPage,
});

type Group = { id: string; key: string; name: string; cargos: string[]; sort: number };
type Person = { id: string; full_name: string; email: string; active: boolean; access_group_id: string | null; role: AppRole };
const NONE = "__none__";
const MODULES = MENU_GROUPS.map((g) => ({ label: g.label, icon: g.icon, items: g.items }));
const ALL_PATHS = MODULES.flatMap((m) => m.items.map((i) => i.url));
const titleOf = new Map(MODULES.flatMap((m) => m.items.map((i) => [i.url, `${m.label} › ${i.title}`] as const)));

function pickRole(list: AppRole[]): AppRole {
  for (const r of ["admin", "programmer", "coordenador", "encarregado", "cliente"] as AppRole[]) if (list.includes(r)) return r;
  return "viewer";
}

/** Contador do módulo: Todas / x de y / —. */
function ModPill({ on, total, active, onClick }: { on: number; total: number; active?: boolean; onClick?: () => void }) {
  const cls = on === total ? "bg-success/15 text-success" : on ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn("inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", cls, active && "ring-2 ring-primary", !onClick && "cursor-default")}>
      {on === total ? "Todas" : on ? `${on}/${total}` : "—"}
    </button>
  );
}

/**
 * Acessos (migração 0128): cada pessoa fica num grupo (vem do cargo do cadastro ao ativar; dá para trocar), o grupo
 * libera as páginas do menu e o que for diferente fica como exceção da pessoa (user_page_access). O perfil passa a ser
 * só o alcance dos dados (todos os clientes, clientes vinculados, serviços vinculados).
 */
function AccessPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ["access-groups"],
    queryFn: async () => ((await supabase.from("access_groups").select("*").order("sort")).data ?? []) as Group[],
  });
  const groupPages = useQuery({
    queryKey: ["access-group-pages"],
    queryFn: async () => (await supabase.from("access_group_pages").select("group_id, path, allowed")).data ?? [],
  });
  const people = useQuery({
    queryKey: ["access-people"],
    queryFn: async () => {
      const [{ data: p, error }, { data: roles }] = await Promise.all([
        supabase.from("users_profiles").select("id, full_name, email, active, access_group_id").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (p ?? []).map((u) => ({ ...u, role: pickRole((roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole)) })) as Person[];
    },
  });
  const exceptions = useQuery({
    queryKey: ["access-exceptions"],
    queryFn: async () => (await supabase.from("user_page_access").select("user_id, path, allowed").in("path", ALL_PATHS)).data ?? [],
  });
  const invalidate = () => {
    for (const k of ["access-groups", "access-group-pages", "access-people", "access-exceptions", "group-access", "user-access"]) qc.invalidateQueries({ queryKey: [k] });
  };

  const gPages = useMemo(() => {
    const m = new Map<string, Map<string, boolean>>();
    for (const r of groupPages.data ?? []) { if (!m.has(r.group_id)) m.set(r.group_id, new Map()); m.get(r.group_id)!.set(r.path, r.allowed); }
    return m;
  }, [groupPages.data]);
  const exOf = useMemo(() => {
    const m = new Map<string, Map<string, boolean>>();
    for (const r of exceptions.data ?? []) { if (!m.has(r.user_id)) m.set(r.user_id, new Map()); m.get(r.user_id)!.set(r.path, r.allowed); }
    return m;
  }, [exceptions.data]);
  const groupAllows = (gid: string | null, path: string) => (gid ? gPages.get(gid)?.get(path) ?? false : false);
  const personAllows = (p: Person, path: string) => p.role === "admin" || (exOf.get(p.id)?.get(path) ?? groupAllows(p.access_group_id, path));
  const active = (people.data ?? []).filter((p) => p.active);
  const membersOf = (gid: string) => active.filter((p) => p.access_group_id === gid).length;

  // ---- Grupos ----
  const [openCell, setOpenCell] = useState<{ g: string; m: number } | null>(null);
  const setGroupPage = useMutation({
    mutationFn: async ({ g, path, allowed }: { g: string; path: string; allowed: boolean }) => {
      const { error } = await supabase.from("access_group_pages").upsert({ group_id: g, path, allowed, updated_at: new Date().toISOString() }, { onConflict: "group_id,path" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Não foi possível salvar: " + e.message),
  });
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [gName, setGName] = useState("");
  const [gCargos, setGCargos] = useState("");
  const saveGroup = useMutation({
    mutationFn: async () => {
      const name = gName.trim();
      if (!name) throw new Error("Informe o nome do grupo.");
      const cargos = gCargos.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean);
      if (editing === "new") {
        const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) + "-" + Date.now().toString(36);
        const { data, error } = await supabase.from("access_groups").insert({ key, name, cargos, sort: (groups.data ?? []).length }).select("id").single();
        if (error) throw error;
        // Grupo novo começa sem nenhuma página.
        const { error: e2 } = await supabase.from("access_group_pages").insert(ALL_PATHS.map((path) => ({ group_id: data.id, path, allowed: false })));
        if (e2) throw e2;
      } else if (editing) {
        const { error } = await supabase.from("access_groups").update({ name, cargos }).eq("id", editing.id);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Grupo salvo"); setEditing(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const openEdit = (g: Group | "new") => { setEditing(g); setGName(g === "new" ? "" : g.name); setGCargos(g === "new" ? "" : g.cargos.join("\n")); };

  // ---- Pessoas ----
  const [q, setQ] = useState("");
  const [fg, setFg] = useState("all");
  const [onlyEx, setOnlyEx] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const setPersonGroup = useMutation({
    mutationFn: async ({ user, group }: { user: string; group: string | null }) => {
      const { error } = await supabase.from("users_profiles").update({ access_group_id: group }).eq("id", user);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Grupo da pessoa atualizado"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Exceção: igual ao grupo = apaga; diferente = grava.
  const setPersonPage = useMutation({
    mutationFn: async ({ p, path, allowed }: { p: Person; path: string; allowed: boolean }) => {
      if (allowed === groupAllows(p.access_group_id, path)) {
        const { error } = await supabase.from("user_page_access").delete().eq("user_id", p.id).eq("path", path);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_page_access").upsert({ user_id: p.id, path, allowed, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const clearExceptions = useMutation({
    mutationFn: async (p: Person) => {
      const { error } = await supabase.from("user_page_access").delete().eq("user_id", p.id).in("path", ALL_PATHS);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Exceções removidas: vale só o grupo"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exList = (p: Person) => [...(exOf.get(p.id)?.entries() ?? [])].filter(([path, v]) => v !== groupAllows(p.access_group_id, path));
  const shown = active.filter((p) => (!q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase()))
    && (fg === "all" || (fg === NONE ? !p.access_group_id : p.access_group_id === fg)) && (!onlyEx || exList(p).length));
  const person = active.find((p) => p.id === sel) ?? null;
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const totalEx = active.reduce((s, p) => s + exList(p).length, 0);

  if (!isAdmin) return <p className="text-sm text-muted-foreground">Só administradores alteram acessos.</p>;
  return (
    <div className="space-y-4">
      <PageHeader title="Acessos" description="Cada pessoa fica num grupo (puxado do cargo ao ativar o usuário). O grupo libera as páginas do menu; o que for diferente fica como exceção na pessoa." />
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-md border border-border bg-card px-3 py-1.5"><b className="tabular-nums">{active.length}</b> pessoas ativas</span>
        <span className="rounded-md border border-border bg-card px-3 py-1.5"><b className="tabular-nums">{(groups.data ?? []).length}</b> grupos</span>
        <span className="rounded-md border border-border bg-card px-3 py-1.5"><b className="tabular-nums">{totalEx}</b> exceções</span>
        {active.some((p) => !p.access_group_id && p.role !== "admin") && (
          <span className="rounded-md border border-warning bg-warning/15 px-3 py-1.5">{active.filter((p) => !p.access_group_id && p.role !== "admin").length} sem grupo</span>
        )}
      </div>
      <Tabs pageTabs defaultValue="grupos">
        <TabsList>
          <TabsTrigger value="grupos">Grupos</TabsTrigger>
          <TabsTrigger value="pessoas">Pessoas</TabsTrigger>
        </TabsList>

        <TabsContent value="grupos" className="mt-4 space-y-3">
          <div className="flex justify-end"><Button size="sm" onClick={() => openEdit("new")}><Plus className="h-4 w-4" /> Novo grupo</Button></div>
          <div className="panel overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo · cargos que entram nele</TableHead>
                  {MODULES.map((m) => <TableHead key={m.label} className="text-center">{m.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(groups.data ?? []).map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="min-w-56 whitespace-normal">
                      <div className="flex items-center gap-1 font-semibold">
                        {g.name} <span className="text-xs font-normal text-muted-foreground">· {membersOf(g.id)} pessoa(s)</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Editar ${g.name}`} onClick={() => openEdit(g)}><Pencil className="h-3.5 w-3.5" /></Button>
                      </div>
                      <div className="text-xs text-muted-foreground">{g.cargos.length ? g.cargos.join(" · ") : "Sem cargo ligado (só à mão)"}</div>
                    </TableCell>
                    {MODULES.map((m, mi) => (
                      <TableCell key={m.label} className="text-center">
                        <ModPill on={m.items.filter((i) => groupAllows(g.id, i.url)).length} total={m.items.length}
                          active={openCell?.g === g.id && openCell.m === mi}
                          onClick={() => setOpenCell(openCell?.g === g.id && openCell.m === mi ? null : { g: g.id, m: mi })} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {openCell && (() => {
              const g = (groups.data ?? []).find((x) => x.id === openCell.g); const m = MODULES[openCell.m]!;
              return g ? (
                <div className="border-t border-border p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <b>{g.name} · {m.label}</b>
                    <span className="text-xs text-muted-foreground">Vale para as {membersOf(g.id)} pessoa(s) do grupo (exceções individuais continuam valendo).</span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    {m.items.map((i) => (
                      <label key={i.url} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-sm">
                        <Checkbox checked={groupAllows(g.id, i.url)} onCheckedChange={(v) => setGroupPage.mutate({ g: g.id, path: i.url, allowed: v === true })} />
                        {i.title}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
          </div>
          <p className="text-xs text-muted-foreground">Clique num número para marcar as páginas do módulo no grupo. Ao ativar um usuário novo, o grupo vem do cargo dele no cadastro de Colaboradores.</p>
        </TabsContent>

        <TabsContent value="pessoas" className="mt-4">
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
                <div className="space-y-1">
                  <Label className="block text-xs">Grupo</Label>
                  <Select value={fg} onValueChange={setFg}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value={NONE}>Sem grupo</SelectItem>
                      {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={onlyEx} onCheckedChange={(v) => setOnlyEx(v === true)} /> Só com exceção</label>
              </div>
              <div className="overflow-x-auto">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow><TableHead>Pessoa</TableHead><TableHead>Grupo</TableHead><TableHead>Alcance</TableHead><TableHead className="text-center">Páginas</TableHead><TableHead>Exceções</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((p) => {
                      const ex = exList(p);
                      return (
                        <TableRow key={p.id} className={cn("cursor-pointer", sel === p.id && "bg-primary/5")} onClick={() => setSel(p.id)}>
                          <TableCell><div className="font-medium">{p.full_name || p.email}</div><div className="text-xs text-muted-foreground">{p.email}</div></TableCell>
                          <TableCell>{p.access_group_id ? groupName.get(p.access_group_id) : <span className="text-muted-foreground">sem grupo</span>}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{ROLE_LABEL[p.role]}</TableCell>
                          <TableCell className="text-center tabular-nums">{ALL_PATHS.filter((u) => personAllows(p, u)).length}</TableCell>
                          <TableCell className="max-w-64 whitespace-normal">
                            {ex.slice(0, 3).map(([path, v]) => (
                              <Badge key={path} variant="outline" className={cn("mr-1 mb-0.5", v ? "border-success text-success" : "border-primary text-primary")}>{v ? "+" : "−"} {titleOf.get(path)?.split(" › ")[1]}</Badge>
                            ))}
                            {ex.length > 3 && <Badge variant="outline">+{ex.length - 3}</Badge>}
                            {!ex.length && <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                  <div className="space-y-1">
                    <Label className="block text-xs">Grupo</Label>
                    <Select value={person.access_group_id ?? NONE} onValueChange={(v) => setPersonGroup.mutate({ user: person.id, group: v === NONE ? null : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem grupo</SelectItem>
                        {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(person.role === "encarregado" || person.role === "coordenador" || person.role === "cliente") && (
                      <ForemanWorksButton userId={person.id} name={person.full_name || person.email} perWork={person.role === "cliente"} />
                    )}
                    {exList(person).length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => clearExceptions.mutate(person)}><RotateCcw className="h-4 w-4" /> Tirar exceções</Button>
                    )}
                  </div>
                  {person.role === "admin" && <p className="rounded-md bg-muted p-2 text-xs">Administrador: acessa tudo, independente do grupo.</p>}
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                    {MODULES.map((m) => (
                      <div key={m.label}>
                        <div className="mb-1 flex items-center justify-between border-b border-border pb-1 text-sm font-semibold">
                          <span className="flex items-center gap-1.5"><m.icon className="h-4 w-4" /> {m.label}</span>
                          <ModPill on={m.items.filter((i) => personAllows(person, i.url)).length} total={m.items.length} />
                        </div>
                        {m.items.map((i) => {
                          const ex = exOf.get(person.id)?.get(i.url);
                          const isEx = ex !== undefined && ex !== groupAllows(person.access_group_id, i.url);
                          return (
                            <label key={i.url} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                              <span className={cn(isEx && "font-semibold text-primary")}>{i.title}{isEx && <span className="ml-1 text-xs font-normal">(exceção)</span>}</span>
                              <Checkbox checked={personAllows(person, i.url)} disabled={person.role === "admin"}
                                onCheckedChange={(v) => setPersonPage.mutate({ p: person, path: i.url, allowed: v === true })} />
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Novo grupo" : "Editar grupo"}</DialogTitle>
            <DialogDescription>Os cargos ligados definem o grupo de quem é ativado sem grupo (pelo cadastro de Colaboradores, sem o nível N1–N4).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="grp-name">Nome</Label>
              <Input id="grp-name" value={gName} onChange={(e) => setGName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grp-cargos">Cargos (um por linha)</Label>
              <textarea id="grp-cargos" rows={5} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={gCargos} onChange={(e) => setGCargos(e.target.value)} placeholder={"Analista Administrativo\nAuxiliar Administrativo"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={saveGroup.isPending} onClick={() => saveGroup.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MENU_GROUPS } from "@/lib/menu";
import { CONFIG_ROLES, defaultAllowed, useRoleAccess, useUserAccess } from "@/hooks/use-access";
import { useCurrentUser, ROLE_LABEL, type AppRole } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/acessos")({
  head: () => ({
    meta: [
      { title: "Acessos | AB5 Hub" },
      { name: "description", content: "Defina quais páginas cada tipo de usuário pode acessar." },
      { property: "og:title", content: "Acessos | AB5 Hub" },
      { property: "og:description", content: "Permissões de acesso por tipo de usuário." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccessPage,
});

const EXC = "__exc__";

function pickRole(list: AppRole[]): AppRole {
  if (list.includes("admin")) return "admin";
  if (list.includes("programmer")) return "programmer";
  if (list.includes("coordenador")) return "coordenador";
  if (list.includes("encarregado")) return "encarregado";
  if (list.includes("cliente")) return "cliente";
  return "viewer";
}

function AccessPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("coordenador");
  const [userId, setUserId] = useState<string>("");
  const access = useRoleAccess();
  const isExc = tab === EXC;

  const users = useQuery({
    queryKey: ["users-list-access"],
    enabled: isExc,
    queryFn: async () => {
      const [{ data: p, error }, { data: roles }] = await Promise.all([
        supabase.from("users_profiles").select("id, full_name, email").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (p ?? []).map((u) => ({
        ...u,
        role: pickRole((roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole)),
      }));
    },
  });
  const selUser = (users.data ?? []).find((u) => u.id === userId);
  const userEx = useUserAccess(isExc ? userId : null);

  const role: AppRole = isExc ? (selUser?.role ?? "viewer") : (tab as AppRole);

  const roleAllowed = (url: string) => {
    if (role === "admin" && url === "/admin/acessos") return true;
    const row = (access.data ?? []).find((r) => r.role === role && r.path === url);
    return row ? row.allowed : defaultAllowed(role, url);
  };
  const exception = (url: string) => (isExc ? (userEx.data ?? []).find((r) => r.path === url) : undefined);
  const allowed = (url: string) => exception(url)?.allowed ?? roleAllowed(url);

  const save = useMutation({
    mutationFn: async (rows: { path: string; allowed: boolean }[]) => {
      if (isExc) {
        if (!userId) return;
        // Igual ao padrão do cargo = remove a exceção.
        const same = rows.filter((r) => r.allowed === roleAllowed(r.path)).map((r) => r.path);
        const diff = rows.filter((r) => r.allowed !== roleAllowed(r.path));
        if (same.length) {
          const { error } = await supabase.from("user_page_access").delete().eq("user_id", userId).in("path", same);
          if (error) throw error;
        }
        if (diff.length) {
          const { error } = await supabase
            .from("user_page_access")
            .upsert(diff.map((r) => ({ user_id: userId, ...r })), { onConflict: "user_id,path" });
          if (error) throw error;
        }
        return;
      }
      const { error } = await supabase
        .from("role_page_access")
        .upsert(rows.map((r) => ({ role, ...r })), { onConflict: "role,path" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["role-access"] });
      qc.invalidateQueries({ queryKey: ["user-access"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar: " + e.message),
  });

  const resetUser = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("user_page_access").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-access"] }),
    onError: (e: Error) => toast.error("Não foi possível restaurar: " + e.message),
  });

  const locked = (url: string) =>
    !isAdmin || (isExc && !userId) || (role === "admin" && url === "/admin/acessos");

  return (
    <div className="space-y-4">
      <PageHeader title="Acessos" description="Escolha o tipo de usuário e ligue ou desligue cada página do menu." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {CONFIG_ROLES.map((r) => (
            <TabsTrigger key={r} value={r}>
              {ROLE_LABEL[r]}
            </TabsTrigger>
          ))}
          <TabsTrigger value={EXC}>Exceções</TabsTrigger>
        </TabsList>
      </Tabs>

      {isExc && (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="w-80">
              <SelectValue placeholder="Selecione o usuário" />
            </SelectTrigger>
            <SelectContent>
              {(users.data ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name || u.email} — {ROLE_LABEL[u.role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selUser && (
            <>
              <span className="text-sm text-muted-foreground">
                Padrão do cargo: {ROLE_LABEL[selUser.role]} · {(userEx.data ?? []).length} exceção(ões)
              </span>
              {isAdmin && (userEx.data ?? []).length > 0 && (
                <Button variant="outline" size="sm" onClick={() => resetUser.mutate()}>
                  <RotateCcw className="h-4 w-4" /> Voltar ao padrão do cargo
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {(!isExc || userId) && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MENU_GROUPS.map((g) => {
            const all = g.items.every((i) => allowed(i.url));
            return (
              <div key={g.label} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <g.icon className="h-4 w-4" /> {g.label}
                  </span>
                  {g.items.length > 1 && (
                    <Switch
                      checked={all}
                      disabled={!isAdmin || (isExc && !userId)}
                      onCheckedChange={(v) =>
                        save.mutate(g.items.filter((i) => !locked(i.url)).map((i) => ({ path: i.url, allowed: v })))
                      }
                    />
                  )}
                </div>
                {g.items.map((i) => (
                  <div key={i.url} className="flex items-center justify-between py-1 text-sm">
                    <span className={exception(i.url) ? "font-semibold text-primary" : undefined}>
                      {i.title}
                      {exception(i.url) && <span className="ml-1 text-xs">(exceção)</span>}
                    </span>
                    <Switch
                      checked={allowed(i.url)}
                      disabled={locked(i.url)}
                      onCheckedChange={(v) => save.mutate([{ path: i.url, allowed: v }])}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

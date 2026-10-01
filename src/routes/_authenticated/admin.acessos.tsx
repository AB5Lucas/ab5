import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MENU_GROUPS } from "@/lib/menu";
import { CONFIG_ROLES, defaultAllowed, useRoleAccess } from "@/hooks/use-access";
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

function AccessPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [role, setRole] = useState<AppRole>("coordenador");
  const access = useRoleAccess();

  const allowed = (url: string) => {
    if (role === "admin" && url === "/admin/acessos") return true;
    const row = (access.data ?? []).find((r) => r.role === role && r.path === url);
    return row ? row.allowed : defaultAllowed(role, url);
  };

  const save = useMutation({
    mutationFn: async (rows: { path: string; allowed: boolean }[]) => {
      const { error } = await supabase
        .from("role_page_access")
        .upsert(rows.map((r) => ({ role, ...r })), { onConflict: "role,path" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-access"] }),
    onError: (e: Error) => toast.error("Não foi possível salvar: " + e.message),
  });

  const locked = (url: string) => !isAdmin || (role === "admin" && url === "/admin/acessos");

  return (
    <div className="space-y-4">
      <PageHeader title="Acessos" description="Escolha o tipo de usuário e ligue ou desligue cada página do menu." />
      <Tabs value={role} onValueChange={(v) => setRole(v as AppRole)}>
        <TabsList>
          {CONFIG_ROLES.map((r) => (
            <TabsTrigger key={r} value={r}>
              {ROLE_LABEL[r]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
                    disabled={!isAdmin}
                    onCheckedChange={(v) =>
                      save.mutate(g.items.filter((i) => !locked(i.url)).map((i) => ({ path: i.url, allowed: v })))
                    }
                  />
                )}
              </div>
              {g.items.map((i) => (
                <div key={i.url} className="flex items-center justify-between py-1 text-sm">
                  <span>{i.title}</span>
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
    </div>
  );
}

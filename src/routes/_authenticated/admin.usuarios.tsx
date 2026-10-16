import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteUser, resetUserPassword } from "@/lib/users.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ForemanWorksButton } from "@/components/foreman-works-dialog";
import { useCurrentUser, ROLE_LABEL, type AppRole } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários | Programação Operacional" },
      { name: "description", content: "Usuários do sistema e seus perfis de acesso." },
      { property: "og:title", content: "Usuários | Programação Operacional" },
      { property: "og:description", content: "Gerencie perfis de acesso: administrador, programador e consulta." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin, user } = useCurrentUser();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users-list"],
    queryFn: async () => {
      const [{ data: profiles, error }, { data: roles }] = await Promise.all([
        supabase.from("users_profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (profiles ?? []).map((p) => {
        const list = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole);
        const role: AppRole = list.includes("admin")
          ? "admin"
          : list.includes("programmer")
            ? "programmer"
            : list.includes("coordenador")
              ? "coordenador"
            : list.includes("encarregado")
              ? "encarregado"
              : "viewer";
        return { ...p, role };
      });
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error: delError } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delError) throw delError;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil atualizado");
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar o perfil: " + e.message),
  });

  const setActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase.from("users_profiles").update({ active }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada");
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
    },
    onError: (e: Error) => toast.error("Não foi possível atualizar: " + e.message),
  });

  const [deleting, setDeleting] = useState<{ id: string; full_name: string; email: string } | null>(null);
  const deleteUserFn = useServerFn(deleteUser);
  const remove = useMutation({
    mutationFn: (userId: string) => deleteUserFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Usuário excluído");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir: " + e.message),
  });

  const [resetting, setResetting] = useState<{ id: string; full_name: string; email: string } | null>(null);
  const [tempPwd, setTempPwd] = useState("");
  const resetFn = useServerFn(resetUserPassword);
  const resetPwd = useMutation({
    mutationFn: (v: { userId: string; tempPassword: string }) => resetFn({ data: v }),
    onSuccess: () => {
      toast.success("Senha resetada. Informe a senha provisória ao usuário.");
      setResetting(null);
    },
    onError: (e: Error) => toast.error("Não foi possível resetar: " + e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuários"
        description="Perfis de acesso: Administrador (acesso total), Programador (cria e edita programação) e Consulta (somente leitura)."
      />

      {!isAdmin && (
        <p className="rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
          Somente administradores podem alterar perfis e situação dos usuários.
        </p>
      )}

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.full_name || "—"}
                  {u.id === user?.id && (
                    <Badge variant="outline" className="ml-2">
                      você
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  {isAdmin ? (
                    <Select
                      value={u.role}
                      onValueChange={(role) => setRole.mutate({ userId: u.id, role: role as AppRole })}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["admin", "programmer", "coordenador", "viewer", "encarregado"] as AppRole[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                  )}
                  {isAdmin && (u.role === "encarregado" || u.role === "coordenador") && <ForemanWorksButton userId={u.id} name={u.full_name || u.email} />}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={u.active}
                    disabled={!isAdmin}
                    onCheckedChange={(active) => setActive.mutate({ userId: u.id, active })}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  {isAdmin && u.id !== user?.id && (
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" aria-label="Resetar senha" title="Resetar senha" onClick={() => { setResetting(u); setTempPwd(""); }}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Excluir usuário" onClick={() => setDeleting(u)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar senha?</AlertDialogTitle>
            <AlertDialogDescription>
              Defina uma senha provisória para "{resetting?.full_name || resetting?.email}". Ao entrar com ela, a pessoa será obrigada a criar uma nova senha (sem confirmação por e-mail).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="text" placeholder="Senha provisória (mín. 6 caracteres)" value={tempPwd} onChange={(e) => setTempPwd(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={tempPwd.length < 6 || resetPwd.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (resetting) resetPwd.mutate({ userId: resetting.id, tempPassword: tempPwd });
              }}
            >
              Resetar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta de "{deleting?.full_name || deleting?.email}" será excluída. A pessoa poderá criar a conta novamente com o mesmo e-mail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

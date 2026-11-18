import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Cfg = { requester_id: string; needs_approval: boolean; self_approve: boolean; substitute_id: string | null };

/**
 * Validação por solicitante. O validador é o gestor do cliente da SC (cadastro do serviço); aqui fica só:
 * precisa de validador (desligado = vai direto para Compras). O substituto do gestor fica no cadastro do serviço.
 */
export function ApproversPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const users = useQuery({
    queryKey: ["sc-users"],
    queryFn: async () => (await supabase.from("users_profiles").select("id, full_name, email, active").order("full_name")).data ?? [],
  });
  const cfgs = useQuery({
    queryKey: ["sc-approvers"],
    queryFn: async () => ((await supabase.from("purchase_approvers").select("requester_id, needs_approval, self_approve, substitute_id")).data ?? []) as Cfg[],
  });
  const cfgOf = useMemo(() => new Map((cfgs.data ?? []).map((c) => [c.requester_id, c])), [cfgs.data]);
  const active = (users.data ?? []).filter((u) => u.active !== false);
  const shown = active.filter((u) => !q.trim() || `${u.full_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const label = (u: { full_name: string | null; email: string | null }) => u.full_name || u.email || "—";
  const save = useMutation({
    mutationFn: async ({ requester, patch }: { requester: string; patch: Partial<Cfg> }) => {
      const cur = cfgOf.get(requester) ?? { requester_id: requester, needs_approval: true, self_approve: false, substitute_id: null };
      const { error } = await supabase.from("purchase_approvers").upsert({ ...cur, ...patch, requester_id: requester }, { onConflict: "requester_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Salvo"); qc.invalidateQueries({ queryKey: ["sc-approvers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O validador de cada SC é o <b>gestor do cliente</b> (cadastro do serviço). Aqui você define, por solicitante, se a SC precisa de
        validador (desligado: vai direto para o Comprador). O <b>substituto do gestor</b> (férias) é cadastrado no próprio serviço, em
        Clientes › Serviços.
      </p>
      <div className="space-y-1">
        <Label htmlFor="appr-q" className="text-xs">Buscar</Label>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input id="appr-q" className="pl-8" placeholder="Nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Solicitante</TableHead>
              <TableHead className="text-center">Precisa de validador</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((u) => {
              const c = cfgOf.get(u.id) ?? { requester_id: u.id, needs_approval: true, self_approve: false, substitute_id: null };
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{label(u)}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={c.needs_approval} onCheckedChange={(v) => save.mutate({ requester: u.id, patch: { needs_approval: v } })} aria-label="Precisa de validador" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


const NONE = "__none__";

/** Cada usuário (solicitante) ligado ao seu aprovador. Sem aprovador, a SC não pode ser enviada. */
export function ApproversPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const users = useQuery({
    queryKey: ["sc-users"],
    queryFn: async () => (await supabase.from("users_profiles").select("id, full_name, email, active").order("full_name")).data ?? [],
  });
  const links = useQuery({ queryKey: ["sc-approvers"], queryFn: async () => (await supabase.from("purchase_approvers").select("requester_id, approver_id")).data ?? [] });
  const approverOf = useMemo(() => new Map((links.data ?? []).map((l) => [l.requester_id, l.approver_id])), [links.data]);
  const active = (users.data ?? []).filter((u) => u.active !== false);
  const shown = active.filter((u) => !q.trim() || `${u.full_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const label = (u: { full_name: string | null; email: string | null }) => u.full_name || u.email || "—";
  const save = useMutation({
    mutationFn: async ({ requester, approver }: { requester: string; approver: string }) => {
      const { error } = approver === NONE
        ? await supabase.from("purchase_approvers").delete().eq("requester_id", requester)
        : await supabase.from("purchase_approvers").upsert({ requester_id: requester, approver_id: approver }, { onConflict: "requester_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Aprovador salvo"); qc.invalidateQueries({ queryKey: ["sc-approvers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Escolha quem aprova as solicitações de compra de cada pessoa. A SC enviada vai para esse aprovador e depois para o Comprador.</p>
      <div className="space-y-1">
        <Label htmlFor="appr-q" className="text-xs">Buscar</Label>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input id="appr-q" className="pl-8" placeholder="Nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <Table className="text-sm">
          <TableHeader><TableRow><TableHead>Solicitante</TableHead><TableHead>E-mail</TableHead><TableHead className="w-80">Aprovador</TableHead></TableRow></TableHeader>
          <TableBody>
            {shown.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{label(u)}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Select value={approverOf.get(u.id) ?? NONE} onValueChange={(v) => save.mutate({ requester: u.id, approver: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={NONE}>Sem aprovador</SelectItem>
                      {active.filter((a) => a.id !== u.id).map((a) => <SelectItem key={a.id} value={a.id}>{label(a)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

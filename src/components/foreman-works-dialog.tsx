import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Administrador escolhe quais obras o encarregado pode acessar no RDO. */
export function ForemanWorksButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  // Carrega já na abertura da página para mostrar os clientes atribuídos sem precisar clicar
  const works = useQuery({
    queryKey: ["fw-works-all"],
    queryFn: async () => {
      const { data } = await supabase.from("works").select("id, client_id, clients(name)");
      return data ?? [];
    },
  });
  const linked = useQuery({
    queryKey: ["fw-linked", userId],
    queryFn: async () => {
      const { data } = await supabase.from("foreman_works").select("work_id").eq("user_id", userId);
      return new Set((data ?? []).map((r) => r.work_id));
    },
  });

  // Agrupa os serviços por cliente
  const clients = (() => {
    const map = new Map<string, { id: string; name: string; workIds: string[] }>();
    for (const w of works.data ?? []) {
      if (!w.client_id) continue;
      const c = map.get(w.client_id) ?? { id: w.client_id, name: w.clients?.name ?? "—", workIds: [] };
      c.workIds.push(w.id);
      map.set(w.client_id, c);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  const toggle = useMutation({
    mutationFn: async ({ workIds, on }: { workIds: string[]; on: boolean }) => {
      const cur = linked.data ?? new Set<string>();
      const { error } = on
        ? await supabase
            .from("foreman_works")
            .insert(workIds.filter((id) => !cur.has(id)).map((work_id) => ({ user_id: userId, work_id })))
        : await supabase.from("foreman_works").delete().eq("user_id", userId).in("work_id", workIds);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fw-linked", userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const list = clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const linkedList = clients.filter((c) => c.workIds.some((id) => linked.data?.has(id)));

  return (
    <>
      <Button variant="outline" size="sm" className="mt-1" onClick={() => setOpen(true)}>
        <Building2 className="h-3.5 w-3.5" /> Clientes{works.data && linked.data ? ` (${linkedList.length})` : ""}
      </Button>
      {works.data && linked.data && (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {linkedList.length ? linkedList.map((c) => c.name).join(", ") : "Nenhum cliente atribuído"}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Clientes de {name}</DialogTitle>
          </DialogHeader>
          <Input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {list.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={c.workIds.some((id) => linked.data?.has(id))}
                  onCheckedChange={(v) => toggle.mutate({ workIds: c.workIds, on: !!v })}
                />
                {c.name}
              </label>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

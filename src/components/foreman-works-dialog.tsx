import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Administrador escolhe quais obras o encarregado pode acessar no RDO. */
export function ForemanWorksButton({ userId, name, perWork = false }: { userId: string; name: string; perWork?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  // Carrega já na abertura da página para mostrar os clientes atribuídos sem precisar clicar
  const works = useQuery({
    queryKey: ["fw-works-all"],
    queryFn: async () => {
      const { data } = await supabase.from("works").select("id, name, client_id, clients(name)");
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
    const map = new Map<string, { id: string; name: string; workIds: string[]; works: { id: string; name: string }[] }>();
    for (const w of works.data ?? []) {
      if (!w.client_id) continue;
      const c = map.get(w.client_id) ?? { id: w.client_id, name: w.clients?.name ?? "—", workIds: [], works: [] };
      c.workIds.push(w.id);
      c.works.push({ id: w.id, name: w.name ?? "—" });
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

  // Cliente atribuído vale para todos os serviços dele: completa os que faltarem ao carregar
  const missing = perWork ? [] : linkedList.flatMap((c) => c.workIds.filter((id) => !linked.data?.has(id)));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missing.length) return;
    void supabase
      .from("foreman_works")
      .insert(missing.map((work_id) => ({ user_id: userId, work_id })))
      .then(() => qc.invalidateQueries({ queryKey: ["fw-linked", userId] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, userId]);

  return (
    <>
      <Button variant="outline" size="sm" className="mt-1" onClick={() => setOpen(true)}>
        <Building2 className="h-3.5 w-3.5" /> {perWork ? "Serviços" : "Clientes"}
        {works.data && linked.data ? ` (${perWork ? linked.data.size : linkedList.length})` : ""}
      </Button>
      {works.data && linked.data && (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {perWork
            ? linkedList.flatMap((c) => c.works.filter((w) => linked.data?.has(w.id)).map((w) => `${c.name} - ${w.name}`)).join(", ") || "Nenhum serviço atribuído"
            : linkedList.length ? linkedList.map((c) => c.name).join(", ") : "Nenhum cliente atribuído"}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{perWork ? "Serviços" : "Clientes"} de {name}</DialogTitle>
          </DialogHeader>
          <Input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {perWork && list.map((c) => (
              <div key={c.id} className="py-1">
                <p className="px-2 text-xs font-semibold uppercase text-muted-foreground">{c.name}</p>
                {c.works.map((w) => (
                  <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded px-4 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={!!linked.data?.has(w.id)} onCheckedChange={(v) => toggle.mutate({ workIds: [w.id], on: !!v })} />
                    {w.name}
                  </label>
                ))}
              </div>
            ))}
            {!perWork && list.map((c) => (
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

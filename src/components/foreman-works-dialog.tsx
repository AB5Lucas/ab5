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

  const works = useQuery({
    queryKey: ["fw-works"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("works").select("id, name, active, clients(name)").eq("active", true).order("name");
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

  const toggle = useMutation({
    mutationFn: async ({ workId, on }: { workId: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from("foreman_works").insert({ user_id: userId, work_id: workId })
        : await supabase.from("foreman_works").delete().eq("user_id", userId).eq("work_id", workId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fw-linked", userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const label = (w: { name: string; clients: { name: string } | null }) =>
    w.clients?.name ? `${w.clients.name} - ${w.name}` : w.name;
  const list = (works.data ?? []).filter((w) => label(w).toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Button variant="outline" size="sm" className="mt-1" onClick={() => setOpen(true)}>
        <Building2 className="h-3.5 w-3.5" /> Obras ({linked.data?.size ?? 0})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Obras de {name}</DialogTitle>
          </DialogHeader>
          <Input placeholder="Buscar obra..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {list.map((w) => (
              <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={linked.data?.has(w.id) ?? false}
                  onCheckedChange={(v) => toggle.mutate({ workId: w.id, on: !!v })}
                />
                {label(w)}
              </label>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

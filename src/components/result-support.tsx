import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { UsersRound } from "lucide-react";
import { toast } from "sonner";
import { fetchAll } from "@/lib/results-engine";

export function ResultSupport({ clientId, canWrite }: { clientId?: string; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["result-support", clientId], enabled: open && !!clientId, queryFn: async () => {
    const [people, rules] = await Promise.all([fetchAll<any>((a, b) => supabase.from("collaborators").select("id,full_name").order("full_name").range(a, b)), supabase.from("result_support_allocations").select("collaborator_id").eq("client_id", clientId ?? "")]);
    if (rules.error) throw rules.error;
    return { people, ids: new Set((rules.data ?? []).map((r) => r.collaborator_id)) };
  }});
  const update = useMutation({ mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => {
    if (!clientId || !canWrite) throw new Error("Sem permissão");
    const result = checked ? await supabase.from("result_support_allocations").upsert({ collaborator_id: id, client_id: clientId }) : await supabase.from("result_support_allocations").delete().eq("client_id", clientId).eq("collaborator_id", id);
    if (result.error) throw result.error;
  }, onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["result-support"] }), qc.invalidateQueries({ queryKey: ["work-result"] }), qc.invalidateQueries({ queryKey: ["fin-client-raw"] })]); }, onError: () => toast.error("Não foi possível salvar o apoio rateado") });
  if (!clientId) return null;
  const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><UsersRound className="size-4" />Apoio rateado</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Apoio rateado</DialogTitle></DialogHeader><Input aria-label="Buscar colaborador de apoio" placeholder="Colaborador" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="max-h-96 space-y-2 overflow-auto">{query.isPending ? <p>Carregando...</p> : query.isError ? <p className="text-destructive">Não foi possível carregar os colaboradores.</p> : query.data?.people.filter((p) => normalize(p.full_name).includes(normalize(search))).map((p) => <label key={p.id} className="flex items-center gap-3 py-2"><Checkbox aria-label={p.full_name} checked={query.data?.ids.has(p.id)} disabled={!canWrite || update.isPending} onCheckedChange={(checked) => update.mutate({ id: p.id, checked: checked === true })} />{p.full_name}</label>)}</div></DialogContent></Dialog></>;
}
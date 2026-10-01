import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, GripVertical, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/use-auth";
import { addDays, formatBR, todayISO } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/programacao/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços do dia | AB5 Hub" },
      { name: "description", content: "Divida os colaboradores escalados em cada cliente entre os serviços do dia." },
      { property: "og:title", content: "Serviços do dia | AB5 Hub" },
      { property: "og:description", content: "Distribuição diária do efetivo por serviço de cada cliente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ServicesPage,
});

const SAVED_CLIENT = "servicos-client";

function ServicesPage() {
  const { user, canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const clients = useQuery({
    queryKey: ["servicos-clients", user?.id, canWrite],
    enabled: !!user?.id,
    queryFn: async () => {
      if (canWrite) {
        const { data } = await supabase.from("clients").select("id, name").eq("active", true).order("name");
        return data ?? [];
      }
      const { data: links } = await supabase.from("foreman_works").select("works(client_id, clients(id, name))").eq("user_id", user!.id);
      const m = new Map<string, string>();
      (links ?? []).forEach((l) => {
        const c = l.works?.clients;
        if (c) m.set(c.id, c.name);
      });
      return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });

  useEffect(() => {
    if (clientId || !clients.data?.length) return;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_CLIENT) : null;
    setClientId(clients.data.some((c) => c.id === saved) ? saved! : clients.data[0]!.id);
  }, [clients.data, clientId]);

  function chooseClient(id: string) {
    setClientId(id);
    try { window.localStorage.setItem(SAVED_CLIENT, id); } catch { /* ignora */ }
  }

  const data = useQuery({
    queryKey: ["servicos-day", clientId, date],
    enabled: !!clientId,
    queryFn: async () => {
      const [{ data: works }, { data: sched }] = await Promise.all([
        supabase.from("works").select("id, name, active").eq("client_id", clientId).order("name"),
        supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle(),
      ]);
      const ids = (works ?? []).map((w) => w.id);
      const allocs = sched && ids.length
        ? (await supabase
            .from("daily_allocations")
            .select("id, work_id, collaborator_id, position_id, collaborators(full_name, position_id), positions(name)")
            .eq("schedule_id", sched.id)
            .in("work_id", ids)).data ?? []
        : [];
      return { works: works ?? [], allocs };
    },
  });

  const works = data.data?.works ?? [];
  const allocs = data.data?.allocs ?? [];
  const shown = useMemo(
    () => works.filter((w) => w.active || allocs.some((a) => a.work_id === w.id)),
    [works, allocs],
  );
  const sorted = (list: typeof allocs) =>
    list.slice().sort((a, b) => (a.collaborators?.full_name ?? "").localeCompare(b.collaborators?.full_name ?? "", "pt-BR"));
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["servicos-day"] });
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  const move = useMutation({
    mutationFn: async ({ allocId, workId }: { allocId: string; workId: string }) => {
      const { error } = await supabase.rpc("move_allocation_service", { _alloc_id: allocId, _work_id: workId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc("copy_service_split", { _client_id: clientId, _date: date });
      if (error) throw error;
      return n as number;
    },
    onSuccess: (n) => { toast.success(n ? `${n} colaborador(es) redistribuídos como no dia anterior` : "Nada para copiar do dia anterior"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_client_service", { _client_id: clientId, _name: newName });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Serviço criado");
      setNewOpen(false);
      setNewName("");
      invalidate();
      qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onDropTo(workId: string) {
    setHover(null);
    const id = dragId;
    setDragId(null);
    const a = allocs.find((x) => x.id === id);
    if (!a || a.work_id === workId) return;
    move.mutate({ allocId: a.id, workId });
  }

  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? "";
  const person = (a: (typeof allocs)[number]) => (
    <li
      key={a.id}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); setDragId(a.id); }}
      onDragEnd={() => setDragId(null)}
      className="flex cursor-grab items-center gap-1.5 px-2 py-1 text-xs"
    >
      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-tight">{a.collaborators?.full_name ?? "—"}</p>
        <p className="truncate text-[10px] leading-tight text-muted-foreground">{a.positions?.name ?? "Sem função"}</p>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Serviços" description="Divida os colaboradores escalados no cliente entre os serviços do dia." />
      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <div className="flex items-end gap-1">
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>Hoje</Button>
        </div>
        <div className="min-w-56 flex-1">
          <Label className="text-xs">Cliente</Label>
          <Select value={clientId} onValueChange={chooseClient}>
            <SelectTrigger><SelectValue placeholder={clients.data?.length === 0 ? "Nenhum cliente liberado para você" : "Selecione o cliente"} /></SelectTrigger>
            <SelectContent>
              {(clients.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={!clientId || copy.isPending} onClick={() => copy.mutate()}>
          <Copy className="h-4 w-4" /> Copiar dia anterior
        </Button>
        <Button disabled={!clientId} onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> Novo Serviço
        </Button>
      </div>
      <p className="text-sm capitalize text-muted-foreground">{formatBR(date)}</p>

      {clientId && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((w) => {
              const list = sorted(allocs.filter((a) => a.work_id === w.id));
              return (
                <section
                  key={w.id}
                  onDragOver={(e) => { e.preventDefault(); setHover(w.id); }}
                  onDragLeave={() => setHover((h) => (h === w.id ? null : h))}
                  onDrop={(e) => { e.preventDefault(); onDropTo(w.id); }}
                  className={cn("panel flex h-72 flex-col overflow-hidden transition", hover === w.id && "ring-2 ring-emerald-500")}
                >
                  <header className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-2 py-1.5">
                    <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
                      {clientName} - {w.name}
                    </h2>
                    <Badge variant="outline" className="px-1 py-0 text-[10px]"><Users className="mr-0.5 h-2.5 w-2.5" />{list.length}</Badge>
                  </header>
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                    {list.length === 0 && <li className="px-2 py-4 text-center text-[10px] text-muted-foreground">Arraste colaboradores para cá</li>}
                    {list.map(person)}
                  </ul>
                </section>
              );
            })}
            {shown.length === 0 && !data.isLoading && (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2">
                Este cliente ainda não tem serviços. Use “Novo Serviço”.
              </p>
            )}
          </div>
          <aside className="panel flex max-h-[75vh] flex-col overflow-hidden">
            <header className="border-b border-border bg-secondary/60 px-3 py-2">
              <p className="font-display text-xs font-semibold uppercase tracking-wide">Escalados no cliente</p>
              <p className="text-[11px] text-muted-foreground">{allocs.length} colaborador(es) na Programação do dia</p>
            </header>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {allocs.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">Ninguém escalado neste cliente na Programação.</li>}
              {sorted(allocs).map((a) => (
                <div key={a.id} className="flex items-center">
                  <div className="flex-1">{person(a)}</div>
                  <span className="pr-2 text-[10px] text-muted-foreground">{works.find((w) => w.id === a.work_id)?.name}</span>
                </div>
              ))}
            </ul>
          </aside>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Serviço</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Cliente</Label>
              <Input value={clientName} disabled />
            </div>
            <div>
              <Label>Nome do serviço</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Pintura" autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button disabled={!newName.trim() || create.isPending} onClick={() => create.mutate()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

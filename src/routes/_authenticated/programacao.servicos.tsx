import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Car, ChevronLeft, ChevronRight, ClipboardList, Copy, GripVertical, ListFilter, Plus, Search, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { TransportBuilderDialog } from "@/components/transport-builder-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
const POOL = "__pool__";

function ServicesPage() {
  const { user, canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  // Encarregado entra por padrão no dia seguinte (dia a montar/conferir)
  const { isForeman, loading: userLoading } = useCurrentUser();
  const [dateInit, setDateInit] = useState(false);
  useEffect(() => {
    if (dateInit || userLoading) return;
    setDateInit(true);
    if (isForeman) setDate(addDays(todayISO(), 1));
  }, [dateInit, userLoading, isForeman]);
  const [clientId, setClientId] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [effOpen, setEffOpen] = useState(false);
  const [trOpen, setTrOpen] = useState(false);

  const clients = useQuery({
    queryKey: ["servicos-clients", user?.id, canWrite, date],
    enabled: !!user?.id,
    queryFn: async () => {
      let list: { id: string; name: string }[];
      if (canWrite) {
        const { data } = await supabase.from("clients").select("id, name").eq("active", true).order("name");
        list = data ?? [];
      } else {
        const { data: links } = await supabase.from("foreman_works").select("works(client_id, clients(id, name))").eq("user_id", user!.id);
        const m = new Map<string, string>();
        (links ?? []).forEach((l) => {
          const c = l.works?.clients;
          if (c) m.set(c.id, c.name);
        });
        list = [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      }
      // Apenas clientes com efetivo escalado no dia
      const { data: sched } = await supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle();
      if (!sched) return [];
      const { data: al } = await supabase.from("daily_allocations").select("works(client_id)").eq("schedule_id", sched.id);
      const withStaff = new Set((al ?? []).map((a: any) => a.works?.client_id).filter(Boolean));
      // Clientes com só 1 serviço ativo usam direto o efetivo da Programação
      const { data: act } = await supabase.from("works").select("client_id").eq("active", true).in("client_id", [...withStaff] as string[]);
      const count = new Map<string, number>();
      (act ?? []).forEach((w) => w.client_id && count.set(w.client_id, (count.get(w.client_id) ?? 0) + 1));
      return list.filter((c) => withStaff.has(c.id) && (count.get(c.id) ?? 0) > 1);
    },
  });

  useEffect(() => {
    if (!clients.data) return;
    if (clientId && clients.data.some((c) => c.id === clientId)) return;
    if (!clients.data.length) { if (clientId) setClientId(""); return; }
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
            .select("id, work_id, collaborator_id, position_id, service_assigned, collaborators(full_name, position_id, registration_number), positions(name)")
            .eq("schedule_id", sched.id)
            .in("work_id", ids)).data ?? []
        : [];
      // Quem está de folga, férias ou atestado no dia fica fora (efetivo e transporte)
      const [{ data: off }, { data: vac }, { data: med }] = await Promise.all([
        supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date),
        supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date),
        supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date),
      ]);
      const away = new Set<string>([
        ...(off ?? []).filter((o) => (o.end_date ?? o.date) >= date).map((o) => o.collaborator_id),
        ...(vac ?? []).map((v) => v.collaborator_id),
        ...(med ?? []).map((m) => m.collaborator_id),
      ]);
      return { works: works ?? [], allocs: allocs.filter((a: any) => !away.has(a.collaborator_id)) };
    },
  });

  const works = data.data?.works ?? [];
  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? "";
  const allocs = data.data?.allocs ?? [];
  // Pessoas em integração neste cliente no dia também entram no transporte
  const integ = useQuery({
    queryKey: ["servicos-integ", clientId, clientName, date],
    enabled: !!clientId,
    queryFn: async () => {
      const m = new Map<string, string>();
      const { data: ap } = await supabase.from("appointments").select("collaborator_id, collaborators(full_name)")
        .eq("type", "integracao").eq("client_id", clientId).eq("scheduled_date", date).neq("status", "cancelado");
      (ap ?? []).forEach((a: any) => m.set(a.collaborator_id, a.collaborators?.full_name ?? "—"));
      const { data: sched } = await supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle();
      if (sched && clientName) {
        const { data: st } = await supabase.from("daily_status_entries").select("collaborator_id, collaborators(full_name)")
          .eq("schedule_id", sched.id).eq("box_key", `integracao:${clientName}`);
        (st ?? []).forEach((a: any) => m.set(a.collaborator_id, a.collaborators?.full_name ?? "—"));
      }
      return [...m.entries()].map(([collaborator_id, name]) => ({ collaborator_id, name: `${name} (Integração)` }));
    },
  });
  const assigned = useMemo(() => allocs.filter((a) => a.service_assigned), [allocs]);
  const pool = useMemo(() => allocs.filter((a) => !a.service_assigned), [allocs]);
  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rq = roleSearch.trim().toLowerCase();
    return pool.filter((a) => {
      const c = a.collaborators;
      if (q && !(c?.full_name ?? "").toLowerCase().includes(q) && !(c?.registration_number ?? "").toLowerCase().includes(q)) return false;
      if (rq && !(a.positions?.name ?? "").toLowerCase().includes(rq)) return false;
      return true;
    });
  }, [pool, search, roleSearch]);

  const prefs = useQuery({
    queryKey: ["service-prefs", user?.id, clientId],
    enabled: !!user?.id && !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from("service_display_prefs").select("hidden_work_ids, work_order").eq("client_id", clientId).maybeSingle();
      return data ?? { hidden_work_ids: [] as string[], work_order: [] as string[] };
    },
  });
  const hidden = useMemo(() => new Set(prefs.data?.hidden_work_ids ?? []), [prefs.data]);
  const order = prefs.data?.work_order ?? [];
  const savePrefs = async (patch: { hidden_work_ids?: string[]; work_order?: string[] }) => {
    const next = { hidden_work_ids: [...hidden], work_order: order, ...patch };
    qc.setQueryData(["service-prefs", user?.id, clientId], next);
    const { error } = await supabase
      .from("service_display_prefs")
      .upsert({ user_id: user!.id, client_id: clientId, ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id,client_id" });
    if (error) toast.error(error.message);
  };
  const toggleHidden = (id: string) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id); else n.add(id);
    savePrefs({ hidden_work_ids: [...n] });
  };

  const shown = useMemo(() => {
    const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 9999 : i; };
    return works
      .filter((w) => w.active || allocs.some((a) => a.work_id === w.id && a.service_assigned))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "pt-BR"));
  }, [works, allocs, order]);
  const visible = useMemo(() => shown.filter((w) => !hidden.has(w.id)), [shown, hidden]);
  const [orderDrag, setOrderDrag] = useState<string | null>(null);
  function reorder(targetId: string) {
    const from = orderDrag;
    setOrderDrag(null);
    if (!from || from === targetId) return;
    const ids = shown.map((w) => w.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(targetId) + (shown.findIndex((w) => w.id === from) < shown.findIndex((w) => w.id === targetId) ? 1 : 0), 0, from);
    savePrefs({ work_order: ids });
  }
  const dayLabel = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    const wd = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][new Date(y!, m! - 1, d!).getDay()];
    return `Dia ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} - ${wd}`;
  }, [date]);
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
    if (!a) return;
    if (workId === POOL) {
      if (a.service_assigned) unassign.mutate(a.id);
      return;
    }
    if (a.service_assigned && a.work_id === workId) return;
    move.mutate({ allocId: a.id, workId });
  }

  const unassign = useMutation({
    mutationFn: async (allocId: string) => {
      const { error } = await supabase.rpc("unassign_allocation_service", { _alloc_id: allocId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const effText = useMemo(() => {
    const lines = [`*${clientName.toUpperCase()} - EFETIVO*`, dayLabel, ""];
    visible.forEach((w) => {
      const list = sorted(assigned.filter((a) => a.work_id === w.id));
      if (!list.length) return;
      lines.push(`*${w.name}*`, ...list.map((a) => a.collaborators?.full_name ?? "—"), "");
    });
    return lines.join("\n").trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, assigned, clientName, dayLabel]);

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
            <SelectTrigger><SelectValue placeholder={clients.data?.length === 0 ? "Nenhum cliente com efetivo escalado neste dia" : "Selecione o cliente"} /></SelectTrigger>
            <SelectContent>
              {(clients.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!clientId}>
              <ListFilter className="h-4 w-4" /> Serviços
              {hidden.size > 0 && <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">{visible.length}/{shown.length}</Badge>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Serviços que aparecem</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {shown.map((w) => (
              <DropdownMenuCheckboxItem
                key={w.id}
                checked={!hidden.has(w.id)}
                onCheckedChange={() => toggleHidden(w.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {w.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" disabled={!clientId || copy.isPending} onClick={() => copy.mutate()}>
          <Copy className="h-4 w-4" /> Copiar dia anterior
        </Button>
        <Button variant="outline" disabled={!clientId} onClick={() => setEffOpen(true)}>
          <ClipboardList className="h-4 w-4" /> Montar Efetivo
        </Button>
        <Button variant="outline" disabled={!clientId} onClick={() => setTrOpen(true)}>
          <Car className="h-4 w-4" /> Montar Transporte
        </Button>
        <Button disabled={!clientId} onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> Novo Serviço
        </Button>
      </div>
      <p className="text-sm capitalize text-muted-foreground">{formatBR(date)}</p>

      {clientId && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((w) => {
              const list = sorted(assigned.filter((a) => a.work_id === w.id));
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
            {(integ.data ?? []).length > 0 && (
              <section className="panel flex h-72 flex-col overflow-hidden">
                <header className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-2 py-1.5">
                  <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
                    Integração - {clientName}
                  </h2>
                  <Badge variant="outline" className="px-1 py-0 text-[10px]"><Users className="mr-0.5 h-2.5 w-2.5" />{integ.data!.length}</Badge>
                </header>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {[...integ.data!].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((p) => (
                    <li key={p.collaborator_id} className="px-2 py-1.5 text-xs">{p.name.replace(" (Integração)", "")}</li>
                  ))}
                </ul>
              </section>
            )}
            {shown.length === 0 && !data.isLoading && (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2">
                Este cliente ainda não tem serviços. Use “Novo Serviço”.
              </p>
            )}
          </div>
          <aside
            onDragOver={(e) => { e.preventDefault(); setHover(POOL); }}
            onDragLeave={() => setHover((h) => (h === POOL ? null : h))}
            onDrop={(e) => { e.preventDefault(); onDropTo(POOL); }}
            className={cn("panel flex max-h-[75vh] flex-col overflow-hidden", hover === POOL && "ring-2 ring-emerald-500")}
          >
            <header className="space-y-1.5 border-b border-border bg-secondary/60 px-3 py-2">
              <p className="font-display text-xs font-semibold uppercase tracking-wide">Sem serviço</p>
              <p className="text-[11px] text-muted-foreground">{pool.length} de {allocs.length} colaborador(es) ainda sem serviço</p>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="h-7 pl-7 text-xs" placeholder="Buscar colaborador" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="h-7 pl-7 text-xs" placeholder="Buscar função" value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} />
              </div>
            </header>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {allocs.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">Ninguém escalado neste cliente na Programação.</li>}
              {allocs.length > 0 && filteredPool.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">Todos já estão em um serviço.</li>}
              {sorted(filteredPool).map(person)}
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

      <Dialog open={effOpen} onOpenChange={setEffOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Montar Efetivo — {clientName}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Arraste os serviços para cima ou para baixo para mudar a ordem. A ordem fica salva.</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {visible.map((w) => (
              <li
                key={w.id}
                draggable
                onDragStart={() => setOrderDrag(w.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); reorder(w.id); }}
                className="flex cursor-grab items-center gap-2 px-3 py-2 text-sm"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{w.name}</span>
                <Badge variant="outline" className="text-[10px]">{assigned.filter((a) => a.work_id === w.id).length}</Badge>
              </li>
            ))}
          </ul>
          <Textarea readOnly value={effText} rows={12} className="font-mono text-xs" />
          <DialogFooter>
            <Button onClick={() => navigator.clipboard.writeText(effText).then(() => toast.success("Efetivo copiado"))}>
              <Copy className="h-4 w-4" /> Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransportBuilderDialog
        open={trOpen}
        onOpenChange={setTrOpen}
        date={date}
        clientId={clientId}
        clientName={clientName}
        dayLabel={dayLabel}
        people={[
          ...allocs.map((a) => ({ collaborator_id: a.collaborator_id, name: a.collaborators?.full_name ?? "—" })),
          ...(integ.data ?? []).filter((p) => !allocs.some((a) => a.collaborator_id === p.collaborator_id)),
        ]}
      />
    </div>
  );
}

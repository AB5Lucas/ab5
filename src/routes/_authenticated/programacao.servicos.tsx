import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Car, ChevronLeft, ChevronRight, ClipboardList, Copy, GripVertical, ListFilter, Moon, Plus, Search, Users, X } from "lucide-react";
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
import { addDays, checkAso, checkIntegration, checkRequirements, fetchScheduleContext, formatBR, pendingForWork, todayISO, workRequiresIntegration } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { SERVICE_BADGE_DATE, useServiceDistribution } from "@/hooks/use-service-distribution";

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
  const { user, role } = useCurrentUser();
  // Admin/programador veem todos os clientes; demais só os atribuídos em Usuários
  const canWrite = role === "admin" || role === "programmer";
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const distribution = useServiceDistribution(date);
  useEffect(() => {
    qc.setQueryData(SERVICE_BADGE_DATE, date);
  }, [qc, date]);
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
      if (role === "admin" || role === "programmer") {
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
      const wd = new Date(`${date}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) {
        // Fim de semana: o efetivo é montado aqui, mesmo sem ninguém na Programação
        const { data: act } = await supabase.from("works").select("client_id").eq("active", true).in("client_id", list.map((c) => c.id));
        const count = new Map<string, number>();
        (act ?? []).forEach((w) => w.client_id && count.set(w.client_id, (count.get(w.client_id) ?? 0) + 1));
        return list.filter((c) => (count.get(c.id) ?? 0) > 1);
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
      const [{ data: off }, { data: vac }, { data: med }, { data: trApp }, { data: trBox }] = await Promise.all([
        supabase.from("days_off").select("collaborator_id, date, end_date").lte("date", date),
        supabase.from("vacations").select("collaborator_id").lte("start_date", date).gte("end_date", date),
        supabase.from("medical_leaves").select("collaborator_id").lte("start_date", date).gte("end_date", date),
        supabase.from("appointments").select("collaborator_id").eq("type", "treinamento").eq("scheduled_date", date).neq("status", "cancelado"),
        sched
          ? supabase.from("daily_status_entries").select("collaborator_id").eq("schedule_id", sched.id).eq("box_key", "treinamento")
          : Promise.resolve({ data: [] as { collaborator_id: string }[] }),
      ]);
      // Escalado para treinamento no dia: sai da aba Serviços
      const training = new Set<string>([
        ...(trApp ?? []).map((t) => t.collaborator_id),
        ...(trBox ?? []).map((t) => t.collaborator_id),
      ]);
      const away = new Set<string>([
        ...(off ?? []).filter((o) => (o.end_date ?? o.date) >= date).map((o) => o.collaborator_id),
        ...(vac ?? []).map((v) => v.collaborator_id),
        ...(med ?? []).map((m) => m.collaborator_id),
      ]);
      const kind = (id: string) =>
        (med ?? []).some((m) => m.collaborator_id === id) ? "Atestado"
        : (vac ?? []).some((v) => v.collaborator_id === id) ? "Férias" : "Folga";
      const absent: { kind: string; name: string }[] = [];
      const seenA = new Set<string>();
      allocs.forEach((a: any) => {
        if (!away.has(a.collaborator_id) || seenA.has(a.collaborator_id)) return;
        seenA.add(a.collaborator_id);
        absent.push({ kind: kind(a.collaborator_id), name: a.collaborators?.full_name ?? "—" });
      });
      absent.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      return { works: works ?? [], allocs: allocs.filter((a: any) => !away.has(a.collaborator_id) && !training.has(a.collaborator_id)), absent };
    },
  });

  const works = data.data?.works ?? [];
  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? "";
  const allocs = data.data?.allocs ?? [];
  const absent = data.data?.absent ?? [];
  const absentGroups = ["Folga", "Atestado", "Férias"]
    .map((k) => ({ kind: k, names: absent.filter((a) => a.kind === k).map((a) => a.name) }))
    .filter((g) => g.names.length);
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

  const night = useQuery({
    queryKey: ["work-night", date],
    queryFn: async () => {
      const { data } = await (supabase as any).from("schedule_work_night").select("work_id").eq("schedule_date", date);
      return (data ?? []).map((r: { work_id: string }) => r.work_id);
    },
  });
  const nightSet = useMemo(() => new Set(night.data ?? []), [night.data]);
  const toggleNight = async (workId: string) => {
    const on = nightSet.has(workId);
    const { error } = on
      ? await (supabase as any).from("schedule_work_night").delete().eq("schedule_date", date).eq("work_id", workId)
      : await (supabase as any).from("schedule_work_night").insert({ schedule_date: date, work_id: workId });
    if (error) { toast.error(error.message); return; }
    toast.success(on ? "Serviço voltou para turno diurno" : "Turno noturno marcado para este dia");
    qc.invalidateQueries({ queryKey: ["work-night"] });
    qc.invalidateQueries({ queryKey: ["night-carry"] });
  };

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
    qc.invalidateQueries({ queryKey: ["service-distribution"] });
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
    if (id?.startsWith("new:")) {
      if (workId === POOL) return;
      const cid = id.slice(4);
      const why = blockReason(cid, workId);
      if (why) { toast.error(why); return; }
      addPerson.mutate({ cid, workId });
      return;
    }
    const a = allocs.find((x) => x.id === id);
    if (!a) return;
    if (workId === POOL) {
      if (a.service_assigned) unassign.mutate(a.id);
      return;
    }
    if (a.service_assigned && a.work_id === workId) return;
    move.mutate({ allocId: a.id, workId });
  }

  const isWeekend = true; // montagem liberada em qualquer dia
  const [addSearch, setAddSearch] = useState("");
  const wctx = useQuery({
    queryKey: ["servicos-weekend-ctx", date],
    enabled: isWeekend && !!clientId,
    queryFn: async () => {
      const ctx = await fetchScheduleContext(date);
      const { data: sched } = await supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle();
      const busy = new Map<string, string>();
      if (sched) {
        const { data: al } = await supabase.from("daily_allocations").select("collaborator_id, works(client_id, client, name)").eq("schedule_id", sched.id);
        (al ?? []).forEach((a: any) => busy.set(a.collaborator_id, JSON.stringify({ c: a.works?.client_id, n: `${a.works?.client ?? ""} - ${a.works?.name ?? ""}` })));
      }
      return { ctx, busy };
    },
  });
  const blockReason = (cid: string, workId: string): string | null => {
    const w = wctx.data;
    if (!w) return "Carregando...";
    const b = w.busy.get(cid);
    if (b) {
      const o = JSON.parse(b);
      if (o.c !== clientId) return `Já escalado em ${o.n} neste dia`;
    }
    const ab = w.ctx.absences.get(cid);
    if (ab) return `De ${ab.toLowerCase()} neste dia`;
    if (workRequiresIntegration(w.ctx, workId)) {
      const aso = checkAso(w.ctx, cid, date, workId).status;
      if (aso === "missing") return "Sem ASO";
      if (aso === "expired") return pendingForWork(w.ctx, cid, workId) ? "ASO vencido — aguardando aceite deste cliente na Conferência" : "ASO vencido";
    }
    const req = checkRequirements(w.ctx, workId, cid, date).filter((x) => x.blocking);
    if (req.length) return `Falta: ${req.map((x) => x.label).join(", ")}`;
    return null;
  };
  const candidates = useMemo(() => {
    if (!isWeekend || !wctx.data) return [];
    const here = new Set(allocs.map((a) => a.collaborator_id));
    const q = search.trim().toLowerCase();
    const rq = roleSearch.trim().toLowerCase();
    const posName = new Map(wctx.data.ctx.positions.map((p) => [p.id, p.name.toLowerCase()]));
    const ref = visible[0]?.id ?? works[0]?.id ?? "";
    return wctx.data.ctx.collaborators
      .filter((c) => !here.has(c.id) && (!q || c.full_name.toLowerCase().includes(q) || (c.registration_number ?? "").toLowerCase().includes(q)))
      .filter((c) => !rq || (posName.get(c.position_id ?? "") ?? "").includes(rq))
      .map((c) => ({ id: c.id, name: c.full_name, why: ref ? blockReason(c.id, ref) : null }))
      .sort((a, b) => Number(!!a.why) - Number(!!b.why) || a.name.localeCompare(b.name, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeekend, wctx.data, allocs, search, roleSearch, visible, works, clientId, date]);
  const addPerson = useMutation({
    mutationFn: async ({ cid, workId }: { cid: string; workId: string }) => {
      const { error } = await supabase.rpc("weekend_add_allocation", { _work_id: workId, _date: date, _collaborator_id: cid });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["servicos-weekend-ctx"] }); },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["servicos-weekend-ctx"] }); },
  });
  const removeDay = useMutation({
    mutationFn: async (allocId: string) => {
      const { error } = await supabase.rpc("weekend_remove_allocation", { _alloc_id: allocId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removido do dia"); invalidate(); qc.invalidateQueries({ queryKey: ["servicos-weekend-ctx"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async (allocId: string) => {
      const { error } = await supabase.rpc("unassign_allocation_service", { _alloc_id: allocId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const [clearBox, setClearBox] = useState<{ name: string; ids: string[] } | null>(null);
  const clearAll = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("unassign_allocation_service", { _alloc_id: id });
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => { toast.success(`${n} colaborador(es) retirados do serviço`); setClearBox(null); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); invalidate(); },
  });
  const [relocate, setRelocate] = useState<{ id: string; name: string } | null>(null);
  const [otherClient, setOtherClient] = useState("");
  const allClients = useQuery({
    queryKey: ["relocate-clients"],
    enabled: !!relocate,
    queryFn: async () => (await supabase.from("clients").select("id, name").eq("active", true).order("name")).data ?? [],
  });
  const findClient = (n: string) => allClients.data?.find((c) => c.name.trim().toUpperCase() === n);
  const relocateTo = useMutation({
    mutationFn: async (target: string) => {
      const { error } = await supabase.rpc("relocate_allocation_client" as any, { _alloc_id: relocate!.id, _client_id: target });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador remanejado");
      setRelocate(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ["servicos-weekend-ctx"] });
      qc.invalidateQueries({ queryKey: ["servicos-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const relocateDialog = (
    <Dialog open={!!relocate} onOpenChange={(o) => !o && setRelocate(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Remanejar {relocate?.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Para onde o colaborador vai?</p>
        <div className="grid grid-cols-2 gap-2">
          {["PATIO", "INDUSTRIA"].map((n) => {
            const c = findClient(n);
            return (
              <Button key={n} variant="outline" className="h-14 text-base" disabled={!c || c.id === clientId || relocateTo.isPending} onClick={() => c && relocateTo.mutate(c.id)}>
                {n === "PATIO" ? "Pátio" : "Indústria"}
              </Button>
            );
          })}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Outro cliente</Label>
          <Select value={otherClient} onValueChange={setOtherClient}>
            <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
            <SelectContent>
              {(allClients.data ?? []).filter((c) => c.id !== clientId && !["PATIO", "INDUSTRIA"].includes(c.name.trim().toUpperCase())).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-destructive" disabled={removeDay.isPending} onClick={() => { removeDay.mutate(relocate!.id); setRelocate(null); }}>Só remover do dia</Button>
          <Button disabled={!otherClient || relocateTo.isPending} onClick={() => relocateTo.mutate(otherClient)}>Remanejar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const effText = useMemo(() => {
    const lines = [`*${clientName.toUpperCase()} - EFETIVO*`, dayLabel, ""];
    visible.forEach((w) => {
      const list = sorted(assigned.filter((a) => a.work_id === w.id));
      if (!list.length) return;
      lines.push(`*${w.name}*`, ...list.map((a) => a.collaborators?.full_name ?? "—"), "");
    });
    absentGroups.forEach((g) => lines.push(`*${g.kind}*`, ...g.names, ""));
    const integNames = (integ.data ?? []).map((p) => p.name.replace(" (Integração)", "")).sort((x, y) => x.localeCompare(y, "pt-BR"));
    if (integNames.length) lines.push("*Integração*", ...integNames, "");
    return lines.join("\n").trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, assigned, clientName, dayLabel, absentGroups.map((g) => g.kind + g.names.join()).join("|"), integ.data]);

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
        <p className="flex items-center gap-1 truncate font-medium leading-tight">
          {(() => {
            const st = wctx.data && a.work_id ? checkIntegration(wctx.data.ctx, a.work_id, a.collaborator_id, date).status : null;
            return st === "missing" || st === "expired" ? (
              <span title={st === "missing" ? "Sem integração com este cliente" : "Integração vencida"} className="shrink-0 font-bold text-destructive">!</span>
            ) : null;
          })()}
          <span className="truncate">{a.collaborators?.full_name ?? "—"}</span>
        </p>
        <p className="truncate text-[10px] leading-tight text-muted-foreground">{a.positions?.name ?? "Sem função"}</p>
      </div>
      {isWeekend && (
        <Button type="button" variant="ghost" size="icon" aria-label="Remanejar" title="Remanejar para outro cliente" className="size-9 shrink-0 p-0 text-muted-foreground hover:text-destructive md:size-3 [&_svg]:size-5 md:[&_svg]:size-3" onClick={() => { setRelocate({ id: a.id, name: a.collaborators?.full_name ?? "" }); setOtherClient(""); }}>
          <X />
        </Button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {relocateDialog}
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
              {(clients.data ?? []).map((c) => {
                const pending = distribution.data?.pendingClientIds.includes(c.id) ?? false;
                return <SelectItem key={c.id} value={c.id}><span className="inline-flex items-center gap-1">{c.name}{pending && <span className="size-2 shrink-0 rounded-full bg-destructive" role="img" aria-label="Efetivo sem serviço definido" title="Efetivo sem serviço definido" />}</span></SelectItem>;
              })}
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

      <Dialog open={!!clearBox} onOpenChange={(o) => !o && setClearBox(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Retirar todos do serviço?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Os {clearBox?.ids.length} colaborador(es) de “{clearBox?.name}” voltarão para o efetivo sem serviço.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearBox(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={clearAll.isPending} onClick={() => clearBox && clearAll.mutate(clearBox.ids)}>Retirar todos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                    <h2 className="font-display min-w-0 flex-1 break-words text-[11px] font-semibold uppercase leading-tight tracking-wide">
                      {clientName} - {w.name}
                    </h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pool.length === 0 || move.isPending}
                      onClick={async () => {
                        const ids = pool.map((a) => a.id);
                        for (const id of ids) {
                          const { error } = await supabase.rpc("move_allocation_service", { _alloc_id: id, _work_id: w.id });
                          if (error) { toast.error(error.message); break; }
                        }
                        invalidate();
                        toast.success(`${ids.length} colaborador(es) importados para ${w.name}`);
                      }}
                      title={pool.length ? `Importar todo o efetivo sem serviço (${pool.length}) para este serviço` : "Nenhum colaborador sem serviço para importar"}
                      aria-label="Importar efetivo"
                      className="size-9 shrink-0 rounded p-0 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 md:size-[18px] [&_svg]:size-5 md:[&_svg]:size-3.5"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={list.length === 0 || clearAll.isPending}
                      onClick={() => setClearBox({ name: w.name, ids: list.map((a) => a.id) })}
                      title="Retirar todos os colaboradores deste serviço"
                      aria-label="Retirar todos"
                      className="size-9 shrink-0 rounded p-0 text-muted-foreground/60 hover:text-destructive disabled:opacity-30 md:size-[18px] [&_svg]:size-5 md:[&_svg]:size-3.5"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleNight(w.id)}
                      title={nightSet.has(w.id) ? "Turno noturno neste dia (entra hoje, sai amanhã). Clique para voltar a diurno" : "Marcar turno noturno neste dia"}
                      aria-label="Turno noturno"
                      className={cn("size-9 shrink-0 rounded p-0 md:size-[18px] [&_svg]:size-5 md:[&_svg]:size-3.5", nightSet.has(w.id) ? "bg-info/15 text-info" : "text-muted-foreground/50 hover:text-foreground")}
                    >
                      <Moon />
                    </Button>
                    <Badge variant="outline" className="px-1 py-0 text-[10px]"><Users className="mr-0.5 h-2.5 w-2.5" />{list.length}</Badge>
                  </header>
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                    {list.length === 0 && <li className="px-2 py-4 text-center text-[10px] text-muted-foreground">Arraste colaboradores para cá</li>}
                    {list.map(person)}
                  </ul>
                </section>
              );
            })}
            {absentGroups.map((g) => (
              <section key={g.kind} className="panel flex h-72 flex-col overflow-hidden">
                <header className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-2 py-1.5">
                  <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
                    {g.kind} - {clientName}
                  </h2>
                  <Badge variant="outline" className="px-1 py-0 text-[10px]"><Users className="mr-0.5 h-2.5 w-2.5" />{g.names.length}</Badge>
                </header>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {g.names.map((n) => <li key={n} className="px-2 py-1.5 text-xs">{n}</li>)}
                </ul>
              </section>
            ))}
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
              <p className="font-display text-xs font-semibold uppercase tracking-wide">Adicionar colaborador</p>
              <p className="text-[11px] text-muted-foreground">Arraste para um serviço. Bloqueados mostram o motivo.</p>
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
              {sorted(filteredPool).map(person)}
                  {wctx.isLoading && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Carregando...</li>}
                  {candidates.map((c) => (
                    <li
                      key={c.id}
                      draggable={!c.why}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); setDragId(`new:${c.id}`); }}
                      onDragEnd={() => setDragId(null)}
                      className={cn("flex items-center gap-1.5 px-2 py-1 text-xs", c.why ? "cursor-not-allowed opacity-60" : "cursor-grab")}
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", c.why ? "bg-destructive" : "bg-emerald-500")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium leading-tight">{c.name}</p>
                        {c.why && <p className="truncate text-[10px] leading-tight text-destructive">{c.why}</p>}
                      </div>
                    </li>
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

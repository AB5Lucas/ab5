import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  LayoutGrid,
  Lock,
  LockOpen,
  MapPin,
  Search,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addDays,
  checkIntegration,
  checkRequirements,
  fetchScheduleContext,
  formatBR,
  formatDateBR,
  todayISO,
  INTEGRATION_LABEL,
} from "@/lib/scheduling";
import type { IntegrationStatus, ScheduleContext } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  in_progress: "Em andamento",
  finalized: "Finalizada",
};

type Level = "ok" | "warn" | "block" | "busy";

type Evaluation = {
  level: Level;
  reasons: string[];
  integration: IntegrationStatus | null;
  reqIssues: number;
  reqBlocked: boolean;
  fit: boolean;
};

type DragPayload = { collaboratorId: string; allocationId: string | null; entryId?: string | null };

/** Caixas de situação que podem ser exibidas junto aos cards de obra. */
const STATUS_BOXES = [
  { key: "folga", label: "FOLGAS" },
  { key: "aso", label: "ASO" },
  { key: "medico", label: "MÉDICO" },
  { key: "atestado", label: "ATESTADO" },
  { key: "afastado", label: "AFASTADO" },
  { key: "falta", label: "FALTA" },
  { key: "interjornada", label: "INTERJORNADA" },
  { key: "treinamento", label: "TREINAMENTO" },
] as const;

const BOX_LABEL: Record<string, string> = Object.fromEntries(STATUS_BOXES.map((b) => [b.key, b.label]));
const BOXES_STORAGE_KEY = "planner-status-boxes";

const FILTERS = [
  { key: "available", label: "Disponíveis" },
  { key: "unavailable", label: "Não disponíveis" },
  { key: "allocated", label: "Já alocados" },
  { key: "unallocated", label: "Não alocados" },
  { key: "int_ok", label: "Integração válida" },
  { key: "int_bad", label: "Integração vencida" },
  { key: "req_ok", label: "Requisitos atendidos" },
  { key: "req_warn", label: "Requisitos pendentes" },
  { key: "fit", label: "Aptos para esta obra" },
  { key: "pj_int", label: "Intermitentes/PJs" },
] as const;

/** Contratos ocultos por padrão na lista lateral. */
const HIDDEN_CONTRACTS = ["pj", "intermitente"];

type FilterKey = (typeof FILTERS)[number]["key"];

const LEVEL_DOT: Record<Level, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  block: "bg-destructive",
  busy: "bg-sky-500",
};

const LEVEL_TEXT: Record<Level, string> = {
  ok: "Apto",
  warn: "Pendência",
  block: "Bloqueado",
  busy: "Alocado",
};

export function SchedulePlannerBoard({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (d: string) => void;
}) {
  const { canWrite, isAdmin, user } = useCurrentUser();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [selectedWork, setSelectedWork] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [hoverWork, setHoverWork] = useState<string | null>(null);
  const [hoverPanel, setHoverPanel] = useState(false);
  const [hoverBox, setHoverBox] = useState<string | null>(null);
  const [visibleBoxes, setVisibleBoxes] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(BOXES_STORAGE_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  function toggleBox(key: string) {
    setVisibleBoxes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(BOXES_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignora */
      }
      return next;
    });
  }

  const ctx = useQuery({ queryKey: ["schedule-ctx", date], queryFn: () => fetchScheduleContext(date) });

  const schedule = useQuery({
    queryKey: ["schedule", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_schedules")
        .select("*")
        .eq("schedule_date", date)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const scheduleId = schedule.data?.id ?? null;
  const finalized = schedule.data?.status === "finalized";
  const editable = canWrite && !finalized;

  const allocations = useQuery({
    queryKey: ["allocations", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("*")
        .eq("schedule_id", scheduleId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const statusEntries = useQuery({
    queryKey: ["status-entries", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_status_entries")
        .select("*")
        .eq("schedule_id", scheduleId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const entries = statusEntries.data ?? [];

  const entryByCollaborator = useMemo(() => {
    const m = new Map<string, (typeof entries)[number]>();
    entries.forEach((e) => m.set(e.collaborator_id, e));
    return m;
  }, [entries]);

  const rows = allocations.data ?? [];
  const c = ctx.data;
  const works = c?.works ?? [];
  const people = c?.collaborators ?? [];

  const positionById = useMemo(() => {
    const m = new Map<string, string>();
    (c?.positions ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [c]);

  const personById = useMemo(() => {
    const m = new Map<string, (typeof people)[number]>();
    people.forEach((p) => m.set(p.id, p));
    return m;
  }, [people]);

  const workLabel = (w: (typeof works)[number]) =>
    w.clients?.name ? `${w.clients.name} - ${w.name}` : w.name;

  const allocByCollaborator = useMemo(() => {
    const m = new Map<string, (typeof rows)[number]>();
    rows.forEach((r) => m.set(r.collaborator_id, r));
    return m;
  }, [rows]);

  const base = (over: Partial<Evaluation>): Evaluation => ({
    level: "ok",
    reasons: [],
    integration: null,
    reqIssues: 0,
    reqBlocked: false,
    fit: false,
    ...over,
  });

  /** Valida colaborador → disponibilidade → integração com o cliente → requisitos → conflitos. */
  function evaluate(
    collaboratorId: string,
    workId: string | null,
    opts?: { ignoreEntry?: boolean },
  ): Evaluation {
    const absence = c?.absences.get(collaboratorId);
    const current = allocByCollaborator.get(collaboratorId);
    const currentLabel = () => {
      const w = works.find((x) => x.id === current?.work_id);
      return w ? workLabel(w) : "outra obra";
    };

    if (absence) return base({ level: "block", reasons: [`Indisponível: ${absence.toLowerCase()}`] });

    const entry = entryByCollaborator.get(collaboratorId);
    if (entry && !opts?.ignoreEntry)
      return base({
        level: "block",
        reasons: [`Registrado em ${BOX_LABEL[entry.box_key] ?? entry.box_key}`],
      });

    if (!workId) {
      if (current) return base({ level: "busy", reasons: [`Alocado em ${currentLabel()}`] });
      return base({ level: "ok" });
    }

    const work = works.find((x) => x.id === workId);
    const clientName = work?.clients?.name ?? "cliente";
    const integ = checkIntegration(c as ScheduleContext, workId, collaboratorId, date);

    if (integ.status === "expired")
      return base({
        level: "block",
        integration: integ.status,
        reasons: [`Integração com ${clientName} vencida em ${formatDateBR(integ.expiresAt)}`],
      });
    if (integ.status === "missing")
      return base({
        level: "block",
        integration: integ.status,
        reasons: [`Não possui integração com ${clientName}`],
      });

    const issues = checkRequirements(c as ScheduleContext, workId, collaboratorId, date);
    const blocking = issues.filter((i) => i.blocking);
    const reqIssues = issues.length;

    if (blocking.length > 0)
      return base({
        level: "block",
        integration: integ.status,
        reqIssues,
        reqBlocked: true,
        reasons: blocking.map((i) => i.label),
      });

    const warnings: string[] = issues.map((i) => i.label);
    if (integ.status === "expiring")
      warnings.unshift(`Integração com ${clientName} vence em ${formatDateBR(integ.expiresAt)}`);
    if (integ.status === "no_client") warnings.unshift("Serviço sem cliente vinculado");

    if (current && current.work_id !== workId)
      return base({
        level: "busy",
        integration: integ.status,
        reqIssues,
        reasons: [`Já alocado em ${currentLabel()}`, ...warnings],
      });

    if (warnings.length > 0)
      return base({ level: "warn", integration: integ.status, reqIssues, reasons: warnings });

    return base({ level: "ok", integration: integ.status, fit: true });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !p.full_name.toLowerCase().includes(q) && !p.registration_number.toLowerCase().includes(q))
        return false;
      if (!filters.has("pj_int") && HIDDEN_CONTRACTS.includes((p.contract_type ?? "").toLowerCase()))
        return false;
      if (filters.size === 0) return true;
      const absent = !!c?.absences.get(p.id);
      const alloc = allocByCollaborator.get(p.id);
      const ev = evaluate(p.id, selectedWork);
      for (const f of filters) {
        if (f === "available" && absent) return false;
        if (f === "unavailable" && !absent) return false;
        if (f === "allocated" && !alloc) return false;
        if (f === "unallocated" && alloc) return false;
        if (
          f === "int_ok" &&
          !(ev.integration === "valid" || ev.integration === "expiring" || ev.integration === "not_required")
        )
          return false;
        if (f === "int_bad" && !(ev.integration === "expired" || ev.integration === "missing")) return false;
        if (f === "req_ok" && (ev.reqIssues > 0 || ev.reqBlocked)) return false;
        if (f === "req_warn" && ev.reqIssues === 0) return false;
        if (f === "fit" && !(ev.fit && !alloc)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, search, filters, selectedWork, c, allocByCollaborator]);

  async function ensureSchedule() {
    if (scheduleId) return scheduleId;
    const { data, error } = await supabase
      .from("daily_schedules")
      .insert({ schedule_date: date, status: "draft", created_by: user?.id ?? null })
      .select("id")
      .single();
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["schedule", date] });
    return data.id;
  }

  function invalidate(id?: string | null) {
    qc.invalidateQueries({ queryKey: ["schedule", date] });
    qc.invalidateQueries({ queryKey: ["allocations", id ?? scheduleId] });
    qc.invalidateQueries({ queryKey: ["status-entries", id ?? scheduleId] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  /** Move o colaborador para uma caixa de situação (folga, atestado, etc.). */
  const dropBox = useMutation({
    mutationFn: async ({ collaboratorId, allocationId, boxKey }: DragPayload & { boxKey: string }) => {
      const person = personById.get(collaboratorId);
      const name = person?.full_name ?? "Colaborador";
      const id = await ensureSchedule();
      const alloc = allocationId ?? allocByCollaborator.get(collaboratorId)?.id ?? null;
      if (alloc) {
        const { error } = await supabase.from("daily_allocations").delete().eq("id", alloc);
        if (error) throw error;
      }
      const boxRows = entries.filter((e) => e.box_key === boxKey);
      const sort = boxRows.length ? Math.max(...boxRows.map((e) => e.sort_order)) + 1 : 0;
      const { error } = await supabase
        .from("daily_status_entries")
        .upsert(
          { schedule_id: id, collaborator_id: collaboratorId, box_key: boxKey, sort_order: sort },
          { onConflict: "schedule_id,collaborator_id" },
        );
      if (error) throw error;
      return { id, name, boxKey };
    },
    onSuccess: (r) => {
      toast.success(`${r.name} registrado em ${BOX_LABEL[r.boxKey] ?? r.boxKey}`);
      invalidate(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_status_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro removido da caixa");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drop = useMutation({
    mutationFn: async ({
      collaboratorId,
      allocationId,
      workId,
      beforeSort,
    }: DragPayload & { workId: string; beforeSort?: number }) => {
      if (!c) throw new Error("Carregando dados");
      const person = personById.get(collaboratorId);
      const name = person?.full_name ?? "Colaborador";
      const fromBox = entryByCollaborator.get(collaboratorId) ?? null;
      const ev = evaluate(collaboratorId, workId, { ignoreEntry: true });
      if (ev.level === "block") throw new Error(`${name} não pode ser alocado nesta obra: ${ev.reasons.join(", ")}`);

      const issues = checkRequirements(c, workId, collaboratorId, date);
      const id = await ensureSchedule();
      if (fromBox) {
        const { error } = await supabase.from("daily_status_entries").delete().eq("id", fromBox.id);
        if (error) throw error;
      }
      const targetRows = rows.filter((r) => r.work_id === workId && r.collaborator_id !== collaboratorId);
      const sort = beforeSort ?? (targetRows.length ? Math.max(...targetRows.map((r) => r.sort_order)) + 1 : 0);

      if (allocationId) {
        const { error } = await supabase
          .from("daily_allocations")
          .update({
            work_id: workId,
            sort_order: sort,
            has_pending_requirement: issues.length > 0,
          })
          .eq("id", allocationId);
        if (error) throw error;
      } else {
        const existing = allocByCollaborator.get(collaboratorId);
        if (existing) {
          const { error } = await supabase
            .from("daily_allocations")
            .update({ work_id: workId, sort_order: sort, has_pending_requirement: issues.length > 0 })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("daily_allocations").insert({
            schedule_id: id,
            work_id: workId,
            collaborator_id: collaboratorId,
            position_id: person?.position_id ?? null,
            driver: false,
            source: "manual",
            confirmation_status: "pending",
            has_pending_requirement: issues.length > 0,
            sort_order: sort,
          });
          if (error) throw error;
        }
      }
      return { id, name, warn: ev.level === "warn" ? ev.reasons.join(", ") : null };
    },
    onSuccess: (r) => {
      toast.success(`${r.name} alocado`);
      if (r.warn) toast.warning(`Pendência: ${r.warn}`);
      invalidate(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador removido da obra");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateFromBase = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error("Carregando dados");
      const id = await ensureSchedule();
      const existing = new Set(rows.map((r) => r.collaborator_id));
      const inserts = c.baseTeams
        .filter((b) => !c.absences.has(b.collaborator_id))
        .filter((b) => !existing.has(b.collaborator_id))
        .filter((b) => c.collaborators.some((p) => p.id === b.collaborator_id))
        .map((b, i) => ({
          schedule_id: id,
          work_id: b.work_id,
          collaborator_id: b.collaborator_id,
          position_id: b.position_id,
          driver: false,
          source: "base_team" as const,
          confirmation_status: "pending" as const,
          has_pending_requirement: checkRequirements(c, b.work_id, b.collaborator_id, date).length > 0,
          sort_order: rows.length + i,
        }));
      if (inserts.length === 0) throw new Error("Nenhum colaborador novo das equipes base para incluir");
      const { error } = await supabase.from("daily_allocations").insert(inserts);
      if (error) throw error;
      return { count: inserts.length, id };
    },
    onSuccess: (r) => {
      toast.success(`${r.count} colaborador(es) incluídos das equipes base`);
      invalidate(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyPrevious = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error("Carregando dados");
      const prev = addDays(date, -1);
      const { data: prevSchedule } = await supabase
        .from("daily_schedules")
        .select("id")
        .eq("schedule_date", prev)
        .maybeSingle();
      if (!prevSchedule) throw new Error("Não existe programação no dia anterior");
      const { data: prevRows } = await supabase
        .from("daily_allocations")
        .select("*")
        .eq("schedule_id", prevSchedule.id);
      if (!prevRows || prevRows.length === 0) throw new Error("O dia anterior não tem alocações");

      const id = await ensureSchedule();
      const existing = new Set(rows.map((r) => r.collaborator_id));
      const inserts = prevRows
        .filter((r) => !c.absences.has(r.collaborator_id))
        .filter((r) => !existing.has(r.collaborator_id))
        .map((r, i) => ({
          schedule_id: id,
          work_id: r.work_id,
          collaborator_id: r.collaborator_id,
          position_id: r.position_id,
          vehicle_id: r.vehicle_id,
          driver: r.driver,
          source: "copied_previous_day" as const,
          confirmation_status: "pending" as const,
          has_pending_requirement: checkRequirements(c, r.work_id, r.collaborator_id, date).length > 0,
          sort_order: rows.length + i,
        }));
      if (inserts.length === 0) throw new Error("Nada novo para copiar do dia anterior");
      const { error } = await supabase.from("daily_allocations").insert(inserts);
      if (error) throw error;
      await supabase.from("daily_schedules").update({ copied_from_schedule_id: prevSchedule.id }).eq("id", id);
      return { count: inserts.length, id };
    },
    onSuccess: (r) => {
      toast.success(`${r.count} alocação(ões) copiadas do dia anterior`);
      invalidate(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async (status: "draft" | "in_progress" | "finalized") => {
      if (!scheduleId) throw new Error("Nenhuma programação nesta data");
      if (status === "finalized" && rows.length === 0)
        throw new Error("Não é possível finalizar uma programação vazia");
      const { error } = await supabase
        .from("daily_schedules")
        .update({
          status,
          finalized_at: status === "finalized" ? new Date().toISOString() : null,
          updated_by: user?.id ?? null,
        })
        .eq("id", scheduleId);
      if (error) throw error;
    },
    onSuccess: (_d, status) => {
      toast.success(status === "finalized" ? "Programação finalizada" : "Programação reaberta");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
    setDragging(payload);
  }

  function readPayload(e: React.DragEvent): DragPayload | null {
    try {
      const raw = e.dataTransfer.getData("text/plain");
      return raw ? (JSON.parse(raw) as DragPayload) : dragging;
    } catch {
      return dragging;
    }
  }

  function toggleFilter(k: FilterKey) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const allocatedCount = rows.length;
  const pendingCount = rows.filter((r) => r.has_pending_requirement).length;
  const unavailableCount = c?.absences.size ?? 0;

  return (
    <div className="space-y-4">
      {/* Data, resumo e ações */}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => onDateChange(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium capitalize">{formatBR(date)}</span>
          </div>
          <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => onDateChange(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Input type="date" className="w-40" value={date} onChange={(e) => e.target.value && onDateChange(e.target.value)} />
          <Button variant="ghost" size="sm" onClick={() => onDateChange(todayISO())}>
            Hoje
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={finalized ? "default" : "secondary"}>
            {schedule.data ? STATUS_LABEL[schedule.data.status] : "Não iniciada"}
          </Badge>
          <Badge variant="outline">Colaboradores: {people.length}</Badge>
          <Badge variant="outline">Alocados: {allocatedCount}</Badge>
          <Badge variant="outline">Não alocados: {Math.max(people.length - allocatedCount, 0)}</Badge>
          <Badge variant="outline">Obras: {works.length}</Badge>
          <Badge variant="outline">Indisponíveis: {unavailableCount}</Badge>
          {pendingCount > 0 && (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" /> Pendências: {pendingCount}
            </Badge>
          )}
          {c?.holiday && <Badge variant="secondary">Feriado: {c.holiday}</Badge>}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <LayoutGrid className="h-4 w-4" /> Caixas
                {visibleBoxes.size > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {visibleBoxes.size}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Exibir caixas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUS_BOXES.map((b) => (
                <DropdownMenuCheckboxItem
                  key={b.key}
                  checked={visibleBoxes.has(b.key)}
                  onCheckedChange={() => toggleBox(b.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {b.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {editable && (
            <>
              <Button size="sm" variant="outline" onClick={() => generateFromBase.mutate()} disabled={generateFromBase.isPending}>
                <Users className="h-4 w-4" /> Equipes base
              </Button>
              <Button size="sm" variant="outline" onClick={() => copyPrevious.mutate()} disabled={copyPrevious.isPending}>
                <Copy className="h-4 w-4" /> Copiar dia anterior
              </Button>
            </>
          )}
          {canWrite && schedule.data && (
            finalized ? (
              isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setStatus.mutate("in_progress")}>
                  <LockOpen className="h-4 w-4" /> Reabrir
                </Button>
              )
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setStatus.mutate("finalized")}>
                <Lock className="h-4 w-4" /> Finalizar
              </Button>
            )
          )}
        </div>
      </div>

      {(ctx.isLoading || schedule.isLoading) && (
        <p className="text-sm text-muted-foreground">Carregando programação...</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Obras */}
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {works.length === 0 && !ctx.isLoading && (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2">
              Nenhum serviço ativo cadastrado.
            </p>
          )}
          {works.map((w) => {
            const workRows = rows.filter((r) => r.work_id === w.id);
            const blockedTarget =
              !!dragging && evaluate(dragging.collaboratorId, w.id, { ignoreEntry: true }).level === "block";
            const isHover = hoverWork === w.id;
            return (
              <section
                key={w.id}
                onClick={() => setSelectedWork((s) => (s === w.id ? null : w.id))}
                onDragOver={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  setHoverWork(w.id);
                }}
                onDragLeave={() => setHoverWork((h) => (h === w.id ? null : h))}
                onDrop={(e) => {
                  e.preventDefault();
                  setHoverWork(null);
                  const p = readPayload(e);
                  setDragging(null);
                  if (!p || !editable) return;
                  drop.mutate({ ...p, workId: w.id });
                }}
                className={cn(
                  "panel flex h-fit cursor-pointer flex-col overflow-hidden transition",
                  selectedWork === w.id && "ring-2 ring-primary",
                  isHover && !blockedTarget && "ring-2 ring-emerald-500",
                  isHover && blockedTarget && "ring-2 ring-destructive",
                )}
              >
                <header className="border-b border-border bg-secondary/60 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <h2 className="font-display flex-1 text-sm font-semibold uppercase leading-tight tracking-wide">
                      {workLabel(w)}
                    </h2>
                    <Badge variant="outline" className="shrink-0">
                      <Users className="mr-1 h-3 w-3" />
                      {workRows.length}
                    </Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {[w.clients?.city, w.entry_time?.slice(0, 5) && `Entrada ${w.entry_time.slice(0, 5)}`]
                      .filter(Boolean)
                      .join(" · ") || "Sem cliente vinculado"}
                  </p>
                  {isHover && blockedTarget && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <Ban className="h-3 w-3" /> Não é possível soltar aqui
                    </p>
                  )}
                </header>
                <ul className="max-h-64 flex-1 divide-y divide-border overflow-y-auto">
                  {workRows.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Arraste colaboradores para cá
                    </li>
                  )}
                  {workRows.map((r) => {
                    const p = personById.get(r.collaborator_id);
                    return (
                      <li
                        key={r.id}
                        draggable={editable}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          startDrag(e, { collaboratorId: r.collaborator_id, allocationId: r.id });
                        }}
                        onDragEnd={() => setDragging(null)}
                        onDrop={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setHoverWork(null);
                          const payload = readPayload(e);
                          setDragging(null);
                          if (!payload || !editable) return;
                          drop.mutate({ ...payload, workId: w.id, beforeSort: r.sort_order - 0.5 });
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        {editable && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p?.full_name ?? "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {(r.position_id ? positionById.get(r.position_id) : p?.position_id ? positionById.get(p.position_id) : null) ?? "Sem função"}
                          </p>
                        </div>
                        {r.has_pending_requirement && (
                          <Badge variant="destructive" className="shrink-0">
                            <AlertTriangle className="mr-1 h-3 w-3" /> Pendência
                          </Badge>
                        )}
                        {r.confirmation_status === "confirmed" && (
                          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label="Remover da obra"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRow.mutate(r.id);
                            }}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* Caixas de situação */}
          {STATUS_BOXES.filter((b) => visibleBoxes.has(b.key) || entries.some((e) => e.box_key === b.key)).map((b) => {
            const boxRows = entries.filter((e) => e.box_key === b.key);
            const isHover = hoverBox === b.key;
            return (
              <section
                key={b.key}
                onDragOver={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  setHoverBox(b.key);
                }}
                onDragLeave={() => setHoverBox((h) => (h === b.key ? null : h))}
                onDrop={(e) => {
                  e.preventDefault();
                  setHoverBox(null);
                  const p = readPayload(e);
                  setDragging(null);
                  if (!p || !editable) return;
                  dropBox.mutate({ ...p, boxKey: b.key });
                }}
                className={cn(
                  "panel flex h-fit flex-col overflow-hidden border-dashed transition",
                  isHover && "ring-2 ring-primary",
                )}
              >
                <header className="border-b border-border bg-muted/60 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <h2 className="font-display flex-1 text-sm font-semibold uppercase leading-tight tracking-wide">
                      {b.label}
                    </h2>
                    <Badge variant="outline" className="shrink-0">
                      <Users className="mr-1 h-3 w-3" />
                      {boxRows.length}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Caixa de situação do dia</p>
                </header>
                <ul className="max-h-64 flex-1 divide-y divide-border overflow-y-auto">
                  {boxRows.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Arraste colaboradores para cá
                    </li>
                  )}
                  {boxRows.map((entry) => {
                    const p = personById.get(entry.collaborator_id);
                    return (
                      <li
                        key={entry.id}
                        draggable={editable}
                        onDragStart={(e) =>
                          startDrag(e, {
                            collaboratorId: entry.collaborator_id,
                            allocationId: null,
                            entryId: entry.id,
                          })
                        }
                        onDragEnd={() => setDragging(null)}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        {editable && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p?.full_name ?? "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {(p?.position_id ? positionById.get(p.position_id) : null) ?? "Sem função"}
                          </p>
                        </div>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label="Remover da caixa"
                            onClick={() => removeEntry.mutate(entry.id)}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Painel lateral de colaboradores */}
        <aside
          onDragOver={(e) => {
            if (!editable) return;
            e.preventDefault();
            setHoverPanel(true);
          }}
          onDragLeave={() => setHoverPanel(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHoverPanel(false);
            const p = readPayload(e);
            setDragging(null);
            if (!p || !editable) return;
            if (p.entryId) removeEntry.mutate(p.entryId);
            else if (p.allocationId) removeRow.mutate(p.allocationId);
          }}
          className={cn(
            "panel sticky top-4 flex max-h-[calc(100vh-6rem)] flex-col p-3",
            hoverPanel && "ring-2 ring-primary",
          )}
        >
          <div className="space-y-2">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Colaboradores</h3>
            {selectedWork && (
              <p className="text-xs text-muted-foreground">
                Filtrando para{" "}
                <span className="font-medium text-foreground">
                  {(() => {
                    const w = works.find((x) => x.id === selectedWork);
                    return w ? workLabel(w) : "";
                  })()}
                </span>
              </p>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar colaborador"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleFilter(f.key)}
                  className={cn(
                    "rounded-full border border-border px-2 py-0.5 text-xs transition",
                    filters.has(f.key) ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                  )}
                >
                  {f.label}
                </button>
              ))}
              {filters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters(new Set())}
                  className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline"
                >
                  limpar
                </button>
              )}
            </div>
          </div>

          <ul className="mt-3 flex-1 divide-y divide-border overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <li className="py-6 text-center text-xs text-muted-foreground">Nenhum colaborador encontrado.</li>
            )}
            {filtered.map((p) => {
              const ev = evaluate(p.id, selectedWork);
              const alloc = allocByCollaborator.get(p.id);
              const canDrag = editable && ev.level !== "block";
              const open = expanded.has(p.id);
              return (
                <li
                  key={p.id}
                  draggable={canDrag}
                  onDragStart={(e) => startDrag(e, { collaboratorId: p.id, allocationId: alloc?.id ?? null })}
                  onDragEnd={() => setDragging(null)}
                  className={cn(
                    "text-sm",
                    canDrag ? "cursor-grab active:cursor-grabbing hover:bg-secondary" : "opacity-70",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(p.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-1 py-1 text-left"
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", LEVEL_DOT[ev.level])} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.full_name}</span>
                    <Badge variant={ev.level === "block" ? "destructive" : "outline"} className="shrink-0 text-[10px]">
                      {LEVEL_TEXT[ev.level]}
                    </Badge>
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition", open && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  {open && (
                    <div className="pb-2 pl-5 pr-1">
                      <p className="truncate text-xs text-muted-foreground">
                        {p.position_id ? positionById.get(p.position_id) ?? "Sem função" : "Sem função"}
                        {p.is_driver ? " · motorista" : ""}
                        {p.contract_type ? ` · ${p.contract_type}` : ""}
                      </p>
                      {selectedWork && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          <Badge
                            variant={
                              ev.integration === "valid" || ev.integration === "not_required"
                                ? "outline"
                                : ev.integration === "expiring"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {ev.integration ? INTEGRATION_LABEL[ev.integration] : "Integração"}
                          </Badge>
                          <Badge
                            variant={ev.reqBlocked ? "destructive" : ev.reqIssues > 0 ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {ev.reqBlocked
                              ? "Requisito bloqueante"
                              : ev.reqIssues > 0
                                ? `${ev.reqIssues} requisito(s) pendente(s)`
                                : "Requisitos OK"}
                          </Badge>
                        </div>
                      )}
                      {ev.reasons.length > 0 && (
                        <p className="pt-1 text-xs text-muted-foreground">{ev.reasons.join(" · ")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            Arraste um nome para o card da obra. Para retirar, arraste de volta para esta lista ou use o ✕.
          </p>
        </aside>
      </div>
    </div>
  );
}

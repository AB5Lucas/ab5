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
  SlidersHorizontal,
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
  checkAso,
  checkIntegration,
  checkRequirements,
  fetchScheduleContext,
  formatBR,
  formatDateBR,
  todayISO,
  previousScheduleDay,
  workRequiresIntegration,
  ASO_LABEL,
  INTEGRATION_LABEL,
} from "@/lib/scheduling";
import type { AsoStatus, IntegrationStatus, ScheduleContext } from "@/lib/scheduling";
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
  aso: AsoStatus | null;
  reqIssues: number;
  reqBlocked: boolean;
  fit: boolean;
  /** Indisponível por ausência/compromisso/caixa: aparece como ocupado, mas não pode ser alocado. */
  hardBlock?: boolean;
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
  { key: "ferias", label: "FÉRIAS" },
  { key: "integracao", label: "INTEGRAÇÃO" },
] as const;

const BOX_LABEL: Record<string, string> = Object.fromEntries(STATUS_BOXES.map((b) => [b.key, b.label]));

/** Caixas alimentadas automaticamente (ausências e agendamentos) — não aparecem no menu. */
const AUTO_BOX_KEYS = ["aso", "treinamento", "integracao", "folga", "ferias"];

/** Caixas que o usuário liga manualmente pelo botão "Caixas". */
const MANUAL_BOXES = STATUS_BOXES.filter((b) => !AUTO_BOX_KEYS.includes(b.key));

/** Ausências cadastradas → caixa correspondente (alimentada automaticamente). */
const ABSENCE_BOX: Record<string, string> = {
  "Férias": "ferias",
  "Atestado": "atestado",
  "Folga": "folga",
};
const BOXES_STORAGE_KEY = "planner-status-boxes";

/** Sábado ou domingo: o dia começa sem nenhum cliente marcado (sem herança da sexta). */
function isWeekendDate(iso: string) {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6;
}

/** Tipo de agendamento → caixa correspondente na programação. */
const APPOINTMENT_BOX: Record<string, string> = {
  aso: "aso",
  treinamento: "treinamento",
  integracao: "integracao",
};

/** Prefixo das caixas de integração (uma por cliente). */
const INTEGRATION_PREFIX = "integracao:";

/** Nome do cliente da caixa de integração. */
function integrationClientOf(boxKey: string) {
  return boxKey.slice(INTEGRATION_PREFIX.length);
}

/** Rótulo de uma caixa (inclui as dinâmicas de integração por cliente). */
function boxLabelOf(boxKey: string): string {
  if (boxKey.startsWith(INTEGRATION_PREFIX))
    return `INTEGRAÇÃO - ${integrationClientOf(boxKey).toUpperCase()}`;
  return BOX_LABEL[boxKey] ?? boxKey;
}

type AppointmentRow = {
  type: string;
  collaborator_id: string;
  scheduled_time?: string | null;
  notes?: string | null;
  trainings: { name: string } | null;
  clients: { name: string } | null;
};

/** Nome do cliente do agendamento de integração. */
function appointmentClientName(a: AppointmentRow): string {
  return a.clients?.name ?? "—";
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "2026-09-16" → "Dia 16/09 - Quarta" */
function dayLine(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `Dia ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} - ${wd}`;
}

/** "07:00:00" → "07h"; "07:30" → "07h30" */
function hourLabel(time?: string | null): string {
  if (!time) return "";
  const [h, min] = time.split(":");
  return min && min !== "00" ? `${h}h${min}` : `${h}h`;
}

const ASO_FOOTER = `👉ATENÇÃO👈

👉Lembre-se de fazer jejum de 12 horas para não alterar os resultados dos exames.

👉Solicitamos que após realização de exame periódico peçam à recepção da clínica uma declaração de comparecimento, constando data e o horário de chegada e saída, para fins de abono de horas.

👉Após o exame retornar a INDUSTRIA.`;

const ASO_ADDRESS =
  "Av. Bandeirantes, 1.645, no piso superior do Boulevard Bandeiras, no Parque Cidade Nova.";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Mensagem copiada!");
  } catch {
    toast.error("Não foi possível copiar a mensagem");
  }
}

/** Texto do box do compromisso agendado. */
function appointmentLabel(a: AppointmentRow): string {
  if (a.type === "aso") return "Exame ASO";
  if (a.type === "treinamento") return `Treinamento - ${a.trainings?.name ?? "—"}`;
  return `Integração - ${appointmentClientName(a)}`;
}

/** Caixa do agendamento — integrações são separadas por cliente. */
function appointmentBoxKey(a: AppointmentRow): string | null {
  if (a.type === "integracao") return `${INTEGRATION_PREFIX}${appointmentClientName(a)}`;
  return APPOINTMENT_BOX[a.type] ?? null;
}

const FILTERS = [
  { key: "allocated", label: "Já alocados" },
  { key: "unallocated", label: "Não alocados" },
  { key: "warn", label: "Com pendência" },
  { key: "blocked", label: "Bloqueados" },
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
  const [roleSearch, setRoleSearch] = useState("");
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [selectedWork, setSelectedWork] = useState<string | null>(null);

  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [hoverWork, setHoverWork] = useState<string | null>(null);
  const [hoverPanel, setHoverPanel] = useState(false);
  const [hoverBox, setHoverBox] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [visibleBoxes, setVisibleBoxes] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(BOXES_STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as string[]) : [];
      return new Set(saved.filter((k) => !AUTO_BOX_KEYS.includes(k)));
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

  /** Clientes visíveis no dia — salvo no banco; dias sem configuração herdam o dia anterior. */
  const visibility = useQuery({
    queryKey: ["client-visibility", date],
    queryFn: async () => {
      const own = await supabase
        .from("schedule_client_visibility")
        .select("client_id, visible")
        .eq("schedule_date", date);
      if (own.error) throw own.error;
      if ((own.data ?? []).length > 0) return own.data ?? [];
      if (isWeekendDate(date)) return [];
      const prev = await supabase
        .from("schedule_client_visibility")
        .select("schedule_date")
        .lt("schedule_date", date)
        .order("schedule_date", { ascending: false })
        .limit(1);
      if (prev.error) throw prev.error;
      const prevDate = prev.data?.[0]?.schedule_date;
      if (!prevDate) return [];
      const inherited = await supabase
        .from("schedule_client_visibility")
        .select("client_id, visible")
        .eq("schedule_date", prevDate);
      if (inherited.error) throw inherited.error;
      return inherited.data ?? [];
    },
  });

  const visibleClients = useMemo(
    () => new Set((visibility.data ?? []).filter((v) => v.visible).map((v) => v.client_id)),
    [visibility.data],
  );

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

  /** Agendamentos (ASO, treinamento, integração) marcados para esta data. */
  const appointments = useQuery({
    queryKey: ["appointments-day", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, type, collaborator_id, scheduled_time, notes, training_id, client_id, trainings(name), clients(name)",
        )
        .eq("scheduled_date", date)
        .in("status", ["agendado", "realizado"]);
      if (error) throw error;
      return data;
    },
  });

  /** Ausências cadastradas (férias, atestado, folga) alimentam automaticamente as caixas. */
  const absenceMembers = useMemo(() => {
    const m = new Map<string, { id: string; note: string }[]>();
    (ctx.data?.absences ?? new Map<string, string>()).forEach((reason, collaboratorId) => {
      const key = ABSENCE_BOX[reason] ?? null;
      if (!key) return;
      const list = m.get(key) ?? [];
      list.push({ id: collaboratorId, note: "Cadastrado" });
      m.set(key, list);
    });
    (appointments.data ?? []).forEach((a) => {
      const key = appointmentBoxKey(a as AppointmentRow);
      if (!key) return;
      const list = m.get(key) ?? [];
      if (list.some((x) => x.id === a.collaborator_id)) return;
      list.push({ id: a.collaborator_id, note: appointmentLabel(a) });
      m.set(key, list);
    });
    return m;
  }, [ctx.data, appointments.data]);

  /** Colaborador → compromisso agendado do dia (bloqueia alocação). */
  const appointmentByCollaborator = useMemo(() => {
    const m = new Map<string, string>();
    (appointments.data ?? []).forEach((a) => m.set(a.collaborator_id, appointmentLabel(a)));
    return m;
  }, [appointments.data]);

  /** Caixa → agendamentos do dia (usados para montar a mensagem do card). */
  const appointmentsByBox = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>();
    (appointments.data ?? []).forEach((a) => {
      const key = appointmentBoxKey(a as AppointmentRow);
      if (!key) return;
      const list = m.get(key) ?? [];
      list.push(a as AppointmentRow);
      m.set(key, list);
    });
    return m;
  }, [appointments.data]);

  /** Mensagem pronta (WhatsApp) para uma caixa de situação. */
  const buildBoxMessage = (boxKey: string, boxLabel: string, names: string[]) => {
    const list = names.join("\n");
    const appts = appointmentsByBox.get(boxKey) ?? [];
    const first = appts[0];
    const hour = hourLabel(first?.scheduled_time);
    if (boxKey === "aso") {
      return [
        "*EXAME ASO*",
        ASO_ADDRESS,
        `${dayLine(date)}${hour ? ` as ${hour}` : ""}`,
        "",
        list,
        "",
        ASO_FOOTER,
      ].join("\n");
    }
    if (boxKey === "treinamento") {
      const nr = first?.trainings?.name ?? "";
      return [
        `*TREINAMENTO ${nr}*`.replace(" *", "*"),
        `${dayLine(date)}${hour ? ` as ${hour}` : ""}`,
        "Local: Sala de Treinamentos AB5",
        "",
        list,
      ].join("\n");
    }
    if (boxKey.startsWith(INTEGRATION_PREFIX) || boxKey === "integracao") {
      const client = first?.clients?.name ?? integrationClientOf(boxKey);
      const obs = first?.notes?.trim();
      return [
        `*${client} - INTEGRAÇÃO*`,
        `${dayLine(date)}${hour ? ` as ${hour}` : ""}`,
        ...(obs ? [`*${obs}*`] : []),
        "",
        list,
      ].join("\n");
    }
    return [`*${boxLabel}*`, dayLine(date), "", list].join("\n");
  };

  const entryByCollaborator = useMemo(() => {
    const m = new Map<string, (typeof entries)[number]>();
    entries.forEach((e) => m.set(e.collaborator_id, e));
    return m;
  }, [entries]);

  const rows = allocations.data ?? [];
  const c = ctx.data;
  const works = c?.works ?? [];
  /** Clientes com serviços ativos (lista do botão "Clientes"). */
  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    works.forEach((w) => {
      if (w.client_id && w.clients?.name) m.set(w.client_id, w.clients.name);
    });
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [works]);

  /** Quadros exibidos no dia: só os serviços de clientes marcados. */
  const shownWorks = works.filter((w) => !w.client_id || visibleClients.has(w.client_id));
  const people = c?.collaborators ?? [];

  const toggleClientVisible = useMutation({
    mutationFn: async (clientId: string) => {
      const next = new Set(visibleClients);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      const payload = clientOptions.map((cl) => ({
        schedule_date: date,
        client_id: cl.id,
        visible: next.has(cl.id),
      }));
      const { error } = await supabase
        .from("schedule_client_visibility")
        .upsert(payload, { onConflict: "schedule_date,client_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-visibility", date] }),
    onError: (e: Error) => toast.error(e.message),
  });

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

  const roleQuery = roleSearch.trim().toLowerCase();
  /** O colaborador atende ao filtro de função digitado? */
  const matchesRole = (collaboratorId: string, positionOverride?: string | null) => {
    if (!roleQuery) return true;
    const posId = positionOverride ?? personById.get(collaboratorId)?.position_id ?? null;
    const name = posId ? positionById.get(posId) ?? "" : "";
    return name.toLowerCase().includes(roleQuery);
  };


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
    aso: null,
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

    if (absence)
      return base({ level: "busy", hardBlock: true, reasons: [`Indisponível: ${absence.toLowerCase()}`] });

    const appointment = appointmentByCollaborator.get(collaboratorId);
    if (appointment)
      return base({ level: "busy", hardBlock: true, reasons: [`Compromisso agendado: ${appointment}`] });


    const entry = entryByCollaborator.get(collaboratorId);
    if (entry && !opts?.ignoreEntry)
      return base({
        level: "busy",
        hardBlock: true,
        reasons: [`Registrado em ${boxLabelOf(entry.box_key)}`],
      });

    if (!workId) {
      if (current) return base({ level: "busy", reasons: [`Alocado em ${currentLabel()}`] });
      return base({ level: "ok" });
    }

    const work = works.find((x) => x.id === workId);
    const clientName = work?.clients?.name ?? "cliente";
    const integ = checkIntegration(c as ScheduleContext, workId, collaboratorId, date);
    const requiresInt = workRequiresIntegration(c as ScheduleContext, workId);
    const aso = checkAso(c as ScheduleContext, collaboratorId, date);

    const intBad = integ.status === "expired" || integ.status === "missing";
    const asoBad = requiresInt && (aso.status === "expired" || aso.status === "missing");

    if (intBad || asoBad) {
      const blockers: string[] = [];
      if (integ.status === "expired")
        blockers.push(`Integração com ${clientName} vencida em ${formatDateBR(integ.expiresAt)}`);
      if (integ.status === "missing") blockers.push(`Não possui integração válida com ${clientName}`);
      if (asoBad)
        blockers.push(
          aso.status === "expired"
            ? `ASO vencido em ${formatDateBR(aso.expiresAt)}`
            : "Não possui ASO válido",
        );
      return base({ level: "block", integration: integ.status, aso: aso.status, reasons: blockers });
    }

    const issues = checkRequirements(c as ScheduleContext, workId, collaboratorId, date);
    const blocking = issues.filter((i) => i.blocking);
    const reqIssues = issues.length;

    if (blocking.length > 0)
      return base({
        level: "block",
        integration: integ.status,
        aso: aso.status,
        reqIssues,
        reqBlocked: true,
        reasons: blocking.map((i) => i.label),
      });

    const warnings: string[] = issues.map((i) => i.label);
    if (integ.status === "expiring")
      warnings.unshift(`Integração com ${clientName} vence em ${formatDateBR(integ.expiresAt)}`);
    if (requiresInt && aso.status === "expiring")
      warnings.unshift(`ASO vence em ${formatDateBR(aso.expiresAt)}`);
    if (integ.status === "no_client") warnings.unshift("Serviço sem cliente vinculado");

    if (current && current.work_id !== workId)
      return base({
        level: "busy",
        integration: integ.status,
        aso: aso.status,
        reqIssues,
        reasons: [`Já alocado em ${currentLabel()}`, ...warnings],
      });

    if (warnings.length > 0)
      return base({ level: "warn", integration: integ.status, aso: aso.status, reqIssues, reasons: warnings });

    return base({ level: "ok", integration: integ.status, aso: aso.status, fit: true });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !p.full_name.toLowerCase().includes(q) && !p.registration_number.toLowerCase().includes(q))
        return false;
      if (!matchesRole(p.id)) return false;
      if (!filters.has("pj_int") && HIDDEN_CONTRACTS.includes((p.contract_type ?? "").toLowerCase()))
        return false;
      const alloc = allocByCollaborator.get(p.id);
      const ev = evaluate(p.id, selectedWork);
      // Com uma obra selecionada, mostra somente quem está apto para ela
      // (alocado ou não), a menos que o usuário peça para ver todos.
      if (selectedWork && !showAll && (ev.level === "block" || ev.hardBlock)) return false;
      for (const f of filters) {
        if (f === "allocated" && !alloc) return false;
        if (f === "unallocated" && (alloc || ev.hardBlock)) return false;
        if (f === "warn" && ev.level !== "warn") return false;
        if (f === "blocked" && ev.level !== "block") return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, search, roleQuery, filters, selectedWork, showAll, c, allocByCollaborator]);


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
      toast.success(`${r.name} registrado em ${boxLabelOf(r.boxKey)}`);
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
      if (ev.level === "block" || ev.hardBlock)
        throw new Error(`${name} não pode ser alocado nesta obra: ${ev.reasons.join(", ")}`);

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
        .filter((b) => !appointmentByCollaborator.has(b.collaborator_id))
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
      const prev = previousScheduleDay(date);
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
        .filter((r) => !appointmentByCollaborator.has(r.collaborator_id))
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

  const effectiveRows = rows.filter(
    (r) => !appointmentByCollaborator.has(r.collaborator_id) && !c?.absences.has(r.collaborator_id),
  );
  const allocatedCount = effectiveRows.length;
  const pendingCount = effectiveRows.filter((r) => r.has_pending_requirement).length;
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
              {MANUAL_BOXES.map((b) => (
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MapPin className="h-4 w-4" /> Clientes
                <Badge variant="secondary" className="ml-1">
                  {visibleClients.size}/{clientOptions.length}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
              <DropdownMenuLabel>Clientes do dia</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {clientOptions.map((cl) => (
                <DropdownMenuCheckboxItem
                  key={cl.id}
                  checked={visibleClients.has(cl.id)}
                  onCheckedChange={() => canWrite && toggleClientVisible.mutate(cl.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {cl.name}
                </DropdownMenuCheckboxItem>
              ))}
              {clientOptions.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum cliente cadastrado.</p>
              )}
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

      <div className="grid gap-2 lg:grid-cols-[1fr_209px]">
        {/* Obras */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shownWorks.length === 0 && !ctx.isLoading && (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2">
              {clientOptions.length === 0
                ? "Nenhum cliente com serviço ativo cadastrado."
                : "Nenhum cliente selecionado para este dia. Use o botão \u201cClientes\u201d."}
            </p>
          )}
          {shownWorks.map((w) => {
            const workRows = rows
              .filter(
                (r) =>
                  r.work_id === w.id &&
                  matchesRole(r.collaborator_id, r.position_id) &&
                  !appointmentByCollaborator.has(r.collaborator_id) &&
                  !c?.absences.has(r.collaborator_id),
              )
              .slice()
              .sort((a, b) =>
                (personById.get(a.collaborator_id)?.full_name ?? "").localeCompare(
                  personById.get(b.collaborator_id)?.full_name ?? "",
                  "pt-BR",
                ),
              );
            const blockedTarget =
              !!dragging &&
              (() => {
                const e = evaluate(dragging.collaboratorId, w.id, { ignoreEntry: true });
                return e.level === "block" || !!e.hardBlock;
              })();
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
                  "panel flex h-72 cursor-pointer flex-col overflow-hidden transition",
                  selectedWork === w.id && "ring-2 ring-primary",
                  isHover && !blockedTarget && "ring-2 ring-emerald-500",
                  isHover && blockedTarget && "ring-2 ring-destructive",
                )}
              >
                <header className="border-b border-border bg-secondary/60 px-2 py-1.5">
                  <div className="flex items-start gap-1.5">
                    <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
                      {workLabel(w)}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      title="Copiar mensagem"
                      aria-label="Copiar mensagem"
                      onClick={(e) => {
                        e.stopPropagation();
                        const names = workRows
                          .map((r) => personById.get(r.collaborator_id)?.full_name ?? "")
                          .filter(Boolean);
                        void copyToClipboard(
                          [
                            `*${w.clients?.name ?? w.name}*`,
                            dayLine(date),
                            "",
                            names.join("\n"),
                          ].join("\n"),
                        );
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
                      <Users className="mr-0.5 h-2.5 w-2.5" />
                      {workRows.length}
                    </Badge>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="h-2.5 w-2.5" />
                    {[w.clients?.city, w.entry_time?.slice(0, 5) && `Entrada ${w.entry_time.slice(0, 5)}`]
                      .filter(Boolean)
                      .join(" · ") || "Sem cliente vinculado"}
                  </p>
                  {isHover && blockedTarget && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-destructive">
                      <Ban className="h-2.5 w-2.5" /> Não é possível soltar aqui
                    </p>
                  )}
                </header>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {workRows.length === 0 && (
                    <li className="px-2 py-4 text-center text-[10px] text-muted-foreground">
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
                        className="flex items-center gap-1.5 px-2 py-1 text-xs"
                      >
                        {editable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium leading-tight">{p?.full_name ?? "—"}</p>
                          <p className="truncate text-[10px] leading-tight text-muted-foreground">
                            {(r.position_id ? positionById.get(r.position_id) : p?.position_id ? positionById.get(p.position_id) : null) ?? "Sem função"}
                          </p>
                        </div>
                        {r.has_pending_requirement && (
                          <Badge variant="destructive" className="shrink-0 px-1 py-0 text-[10px]">
                            <AlertTriangle className="mr-0.5 h-2.5 w-2.5" /> Pendência
                          </Badge>
                        )}
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label="Remover da obra"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRow.mutate(r.id);
                            }}
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
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
          {[
            ...STATUS_BOXES.filter((b) => b.key !== "integracao").map((b) => ({
              key: b.key as string,
              label: b.label as string,
            })),
            ...[
              ...new Set([
                ...[...appointmentsByBox.keys()].filter((k) => k.startsWith(INTEGRATION_PREFIX)),
                ...entries.map((e) => e.box_key).filter((k) => k.startsWith(INTEGRATION_PREFIX)),
              ]),
            ]
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .map((key) => ({ key, label: boxLabelOf(key) })),
          ]
            .filter(
              (b) =>
                visibleBoxes.has(b.key) ||
                entries.some((e) => e.box_key === b.key) ||
                (absenceMembers.get(b.key)?.length ?? 0) > 0 ||
                (appointmentsByBox.get(b.key)?.length ?? 0) > 0,
            )
            .map((b) => {
            const nameOf = (id: string) => personById.get(id)?.full_name ?? "";
            const byName = (a: string, c: string) => nameOf(a).localeCompare(nameOf(c), "pt-BR");
            const boxRows = entries
              .filter((e) => e.box_key === b.key)
              .slice()
              .sort((x, y) => byName(x.collaborator_id, y.collaborator_id));
            const autoRows = (absenceMembers.get(b.key) ?? [])
              .filter((a) => !boxRows.some((r) => r.collaborator_id === a.id))
              .slice()
              .sort((x, y) => byName(x.id, y.id));
            const isHover = hoverBox === b.key;
            const handleDrop = (e: React.DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setHoverBox(null);
              const p = readPayload(e);
              setDragging(null);
              if (!p || !editable) return;
              dropBox.mutate({ ...p, boxKey: b.key });
            };
            const handleOver = (e: React.DragEvent) => {
              if (!editable) return;
              e.preventDefault();
              e.stopPropagation();
              setHoverBox(b.key);
            };
            return (
              <section
                key={b.key}
                onDragOver={handleOver}
                onDragLeave={() => setHoverBox((h) => (h === b.key ? null : h))}
                onDrop={handleDrop}
                className={cn(
                  "panel flex h-72 flex-col overflow-hidden border-dashed transition",
                  isHover && "ring-2 ring-primary",
                )}
              >
                <header className="border-b border-border bg-muted/60 px-2 py-1.5">
                  <div className="flex items-start gap-1.5">
                    <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
                      {b.label}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      title="Copiar mensagem"
                      aria-label="Copiar mensagem"
                      onClick={(e) => {
                        e.stopPropagation();
                        const names = [
                          ...autoRows.map((a) => nameOf(a.id)),
                          ...boxRows.map((r) => nameOf(r.collaborator_id)),
                        ].filter(Boolean);
                        void copyToClipboard(buildBoxMessage(b.key, b.label, names));
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
                      <Users className="mr-0.5 h-2.5 w-2.5" />
                      {boxRows.length + autoRows.length}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Caixa de situação do dia</p>
                </header>
                <ul
                  className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
                  onDragOver={handleOver}
                  onDrop={handleDrop}
                >
                  {boxRows.length + autoRows.length === 0 && (
                    <li
                      className="px-2 py-4 text-center text-[10px] text-muted-foreground"
                      onDragOver={handleOver}
                      onDrop={handleDrop}
                    >
                      Arraste colaboradores para cá
                    </li>
                  )}
                  {autoRows.map((a) => {
                    const p = personById.get(a.id);
                    return (
                      <li
                        key={`auto-${a.id}`}
                        onDragOver={handleOver}
                        onDrop={handleDrop}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium leading-tight">{p?.full_name ?? "—"}</p>
                          <p className="truncate text-[10px] leading-tight text-muted-foreground">
                            {(p?.position_id ? positionById.get(p.position_id) : null) ?? "Sem função"}
                          </p>
                        </div>
                        <Badge
                          variant={a.note === "Cadastrado" ? "secondary" : "default"}
                          className="shrink-0 px-1 py-0 text-[9px]"
                        >
                          {a.note}
                        </Badge>
                      </li>
                    );
                  })}
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
                        onDragOver={handleOver}
                        onDrop={handleDrop}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs"
                      >
                        {editable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium leading-tight">{p?.full_name ?? "—"}</p>
                          <p className="truncate text-[10px] leading-tight text-muted-foreground">
                            {(p?.position_id ? positionById.get(p.position_id) : null) ?? "Sem função"}
                          </p>
                        </div>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label="Remover da caixa"
                            onClick={() => removeEntry.mutate(entry.id)}
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
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
            "panel sticky top-4 flex max-h-[calc(100vh-6rem)] flex-col p-2",
            hoverPanel && "ring-2 ring-primary",
          )}
        >
          <div className="space-y-1.5">
            <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide">Colaboradores</h3>
            {selectedWork && (
              <p className="text-[10px] text-muted-foreground">
                {showAll ? "Mostrando todos para" : "Aptos para"}{" "}
                <span className="font-medium text-foreground">
                  {(() => {
                    const w = works.find((x) => x.id === selectedWork);
                    return w ? workLabel(w) : "";
                  })()}
                </span>
                {" · "}
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="underline"
                >
                  {showAll ? "ver só aptos" : "ver todos"}
                </button>
              </p>

            )}
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                placeholder="Buscar colaborador"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 flex-1 justify-between px-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Condições
                    </span>
                    {filters.size > 0 && (
                      <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                        {filters.size}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuLabel>Filtrar colaboradores</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {FILTERS.map((f) => (
                    <DropdownMenuCheckboxItem
                      key={f.key}
                      checked={filters.has(f.key)}
                      onCheckedChange={() => toggleFilter(f.key)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {f.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {filters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters(new Set())}
                  className="shrink-0 text-[10px] text-muted-foreground underline"
                >
                  limpar
                </button>
              )}
            </div>
          </div>

          <ul className="mt-2 flex-1 divide-y divide-border overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <li className="py-4 text-center text-[10px] text-muted-foreground">Nenhum colaborador encontrado.</li>
            )}
            {filtered.map((p) => {
              const ev = evaluate(p.id, selectedWork);
              const alloc = allocByCollaborator.get(p.id);
              const canDrag = editable && ev.level !== "block" && !ev.hardBlock;
              const open = expanded.has(p.id);
              return (
                <li
                  key={p.id}
                  draggable={canDrag}
                  onDragStart={(e) => startDrag(e, { collaboratorId: p.id, allocationId: alloc?.id ?? null })}
                  onDragEnd={() => setDragging(null)}
                  className={cn(
                    "text-xs",
                    canDrag ? "cursor-grab active:cursor-grabbing hover:bg-secondary" : "opacity-70",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(p.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
                  >
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[ev.level])}
                      title={LEVEL_TEXT[ev.level]}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium leading-tight">{p.full_name}</p>
                      <p className="truncate text-[10px] leading-tight text-muted-foreground">
                        {p.position_id ? positionById.get(p.position_id) ?? "Sem função" : "Sem função"}
                      </p>
                    </div>
                    <span className="sr-only">{LEVEL_TEXT[ev.level]}</span>

                    <ChevronDown
                      className={cn("h-3 w-3 shrink-0 text-muted-foreground transition", open && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  {open && (
                    <div className="pb-1.5 pl-4 pr-1">
                      <p className="text-[10px] font-medium">{LEVEL_TEXT[ev.level]}</p>

                      {(p.is_driver || p.contract_type) && (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {[p.is_driver ? "motorista" : null, p.contract_type].filter(Boolean).join(" · ")}
                        </p>
                      )}
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
                            className="px-1 py-0 text-[9px]"
                          >
                            {ev.integration ? INTEGRATION_LABEL[ev.integration] : "Integração"}
                          </Badge>
                          <Badge
                            variant={
                              ev.aso === "valid"
                                ? "outline"
                                : ev.aso === "expiring"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="px-1 py-0 text-[9px]"
                          >
                            {ev.aso ? ASO_LABEL[ev.aso] : "ASO"}
                          </Badge>
                          <Badge
                            variant={ev.reqBlocked ? "destructive" : ev.reqIssues > 0 ? "secondary" : "outline"}
                            className="px-1 py-0 text-[9px]"
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
                        <p className="pt-1 text-[10px] text-muted-foreground">{ev.reasons.join(" · ")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            Arraste um nome para o card da obra. Para retirar, arraste de volta para esta lista ou use o ✕.
          </p>
        </aside>
      </div>
    </div>
  );
}

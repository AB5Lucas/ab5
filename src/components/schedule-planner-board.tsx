import { ScheduleExportButton } from "@/components/schedule-export-dialog";
import { ScheduleAlertsButton } from "@/components/schedule-alerts-button";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BedDouble,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  LayoutGrid,
  MapPin,
  Search,
  SlidersHorizontal,
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
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  addDays,
  asoBlocksWork,
  checkAso,
  pendingForWork,
  checkIntegration,
  checkRequirements,
  fetchScheduleContext,
  formatBR,
  formatDateBR,
  todayISO,
  workRequiresIntegration,
  ASO_LABEL,
  INTEGRATION_LABEL,
} from "@/lib/scheduling";
import type { ScheduleContext } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { copySkipReason } from "@/lib/schedule-copy";
import { scheduleWriteError } from "@/lib/schedule-write-error";
import { formatCpf } from "@/lib/copy-names";
import type { PendingOccurrence } from "@/lib/rdo";
import { RdoAbsenceDialog } from "@/components/rdo-absence-dialog";
import { WeeklyDaysOffDialog } from "@/components/weekly-days-off-dialog";
import { LodgingDialog } from "@/components/lodging-dialog";
import { CopyDayDialog } from "@/components/schedule-planner/copy-day-dialog";
import { SchedulePresence } from "@/components/schedule-planner/schedule-presence";
import { useScheduleBenefits } from "@/components/schedule-planner/use-schedule-benefits";
import { usePlannerMutations } from "@/components/schedule-planner/use-planner-mutations";
import { WorkBox } from "@/components/schedule-planner/work-box";
import { StatusBox } from "@/components/schedule-planner/status-box";
import type { PlannerApi, PlannerRow } from "@/components/schedule-planner/planner-api";
import {
  STATUS_BOXES,
  AUTO_BOX_KEYS,
  MANUAL_BOXES,
  ABSENCE_BOX,
  BOXES_STORAGE_KEY,
  INTEGRATION_PREFIX,
  integrationClientOf,
  boxLabelOf,
  dayLine,
  hourLabel,
  ASO_FOOTER,
  ASO_ADDRESS,
  copyToClipboard,
  appointmentLabel,
  appointmentBoxKey,
  FILTERS,
  HIDDEN_CONTRACTS,
  LEVEL_DOT,
  LEVEL_TEXT,
} from "@/components/schedule-planner/boxes";
import type { Evaluation, DragPayload, AppointmentRow, FilterKey } from "@/components/schedule-planner/boxes";

const NO_ROWS: PlannerRow[] = [];

export function SchedulePlannerBoard({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (d: string) => void;
}) {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  /** Duplicidade (outro usuário gravou o mesmo dia) vira aviso e releitura; o resto mostra a mensagem. */
  const onWriteError = (e: unknown) => scheduleWriteError(qc, e);
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
  const boxesKey = `${BOXES_STORAGE_KEY}:${date}`;
  const [visibleBoxes, setVisibleBoxes] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(boxesKey);
      const saved = raw ? (JSON.parse(raw) as string[]) : [];
      setVisibleBoxes(new Set(saved.filter((k) => !AUTO_BOX_KEYS.includes(k))));
    } catch {
      setVisibleBoxes(new Set());
    }
  }, [boxesKey]);

  function toggleBox(key: string) {
    setVisibleBoxes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(boxesKey, JSON.stringify([...next]));
      } catch {
        /* ignora */
      }
      return next;
    });
  }

  /**
   * Escolhas manuais de quadros do dia (salvas no banco, só deste dia). Não herda mais o dia anterior:
   * por padrão aparecem só os clientes com MO escalada (ver visibleClients).
   */
  const visibility = useQuery({
    queryKey: ["client-visibility", date],
    queryFn: async () => {
      const own = await supabase
        .from("schedule_client_visibility")
        .select("client_id, visible")
        .eq("schedule_date", date);
      if (own.error) throw own.error;
      return own.data ?? [];
    },
  });

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
  const editable = canWrite;
  const canClassify = canWrite;

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

  // Turno noturno iniciado no dia anterior: aparece hoje como continuação (sem novo VT/refeição/prêmio)
  const nightToday = useQuery({
    queryKey: ["work-night", date, "set"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("schedule_work_night").select("work_id").eq("schedule_date", date);
      return new Set((data ?? []).map((r: { work_id: string }) => r.work_id));
    },
  });
  const nightCarry = useQuery({
    queryKey: ["night-carry", date],
    queryFn: async () => {
      const prev = addDays(date, -1);
      const { data: nw } = await (supabase as any).from("schedule_work_night").select("work_id").eq("schedule_date", prev);
      const ids = (nw ?? []).map((r: { work_id: string }) => r.work_id);
      if (ids.length === 0) return new Map<string, string[]>();
      const { data } = await supabase
        .from("daily_allocations")
        .select("collaborator_id, collaborators(full_name), works!inner(client_id), daily_schedules!inner(schedule_date)")
        .eq("daily_schedules.schedule_date", prev)
        .in("work_id", ids);
      const m = new Map<string, string[]>();
      for (const a of (data ?? []) as any[]) {
        const k = a.works?.client_id ?? "";
        m.set(k, [...(m.get(k) ?? []), a.collaborators?.full_name ?? "—"]);
      }
      for (const v of m.values()) v.sort((x, y) => x.localeCompare(y, "pt-BR"));
      return m;
    },
  });

  const pendingOcc = useQuery({
    queryKey: ["rdo-pending", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("rdo_workforce")
        .select("id, rdo_id, work_id, report_date, collaborator_id, allocation_id, reported_reason, reported_note")
        .eq("report_date", date)
        .eq("occurrence_status", "pending");
      return (data ?? []) as PendingOccurrence[];
    },
  });
  const [occOpen, setOccOpen] = useState<PendingOccurrence | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [copyAsk, setCopyAsk] = useState<{ work: any; siblings: any[] } | null>(null);
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
  // Obra de origem de quem foi tirado pelo RDO (folga/falta etc.), lida ao vivo do RDO.
  const rdoOrigin = useQuery({
    queryKey: ["rdo-absence-origin", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rdo_workforce")
        .select("collaborator_id, works(name, clients(name))")
        .eq("report_date", date)
        .eq("present", false)
        .not("reported_reason", "is", null);
      if (error) throw error;
      const m = new Map<string, string[]>();
      for (const r of (data ?? []) as any[]) {
        const n = [r.works?.clients?.name, r.works?.name].filter(Boolean).join(" · ");
        if (n) m.set(r.collaborator_id, [...(m.get(r.collaborator_id) ?? []), n]);
      }
      return m;
    },
  });
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  /** Agendamentos (ASO, treinamento, integração) marcados para esta data. */
  const appointments = useQuery({
    queryKey: ["appointments-day", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, type, collaborator_id, scheduled_time, notes, training_id, client_id, pays_transport_voucher, trainings(name), clients(name)",
        )
        .eq("scheduled_date", date)
        .in("status", ["agendado", "realizado"]);
      if (error) throw error;
      return data;
    },
  });

  const benefits = useScheduleBenefits({
    date, scheduleId, ctx: ctx.data, appointments: appointments.data, editable, ensureSchedule, onWriteError,
  });
  const {
    workVt, workPaysVt, lodgingOf, allocVtOn, travelInfo, workPaysTravel, defaultAllocTravel, setGroupTravel, toggleAllocTravel,
    toggleOvernight, setGroupOvernight, toggleAllocVt, boxPaysVt, boxTitles, saveBoxTitle, toggleBoxVt, travelDot, personBenefits, setGroupVt,
  } = benefits;
  const [editingBox, setEditingBox] = useState<string | null>(null);

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
  const buildBoxMessage = (boxKey: string, boxLabel: string, names: string[], ids: string[] = []) => {
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
      // Um bloco por treinamento e horário: no mesmo quadro pode haver NR-33 e NR-35, cada um com a sua turma.
      const byPerson = new Map(appts.map((a) => [a.collaborator_id, a]));
      const groups = new Map<string, { nr: string; time: string | null; names: string[] }>();
      names.forEach((n, i) => {
        const a = byPerson.get(ids[i] ?? "") ?? first;
        const nr = a?.trainings?.name ?? "";
        const time = a?.scheduled_time ?? null;
        const k = `${nr}|${time ?? ""}`;
        const g = groups.get(k) ?? { nr, time, names: [] };
        g.names.push(n);
        groups.set(k, g);
      });
      return [...groups.values()]
        .sort((x, y) => (x.time ?? "").localeCompare(y.time ?? "") || x.nr.localeCompare(y.nr, "pt-BR", { numeric: true }))
        .map((g) => {
          const h = hourLabel(g.time);
          return [
            `*TREINAMENTO ${g.nr}*`.replace(" *", "*"),
            `${dayLine(date)}${h ? ` as ${h}` : ""}`,
            "Local: Sala de Treinamentos AB5",
            "",
            g.names.join("\n"),
          ].join("\n");
        })
        .join("\n\n");
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
  /** Serviços disponíveis + inativos que tiveram gente escalada nesta data. */
  const works = useMemo(() => {
    const allocated = new Set(rows.map((r: { work_id: string }) => r.work_id));
    return (c?.works ?? []).filter((w) => w.active || allocated.has(w.id));
  }, [c, rows]);
  /** Índices para o desenho (antes um .find por pessoa a cada render). */
  const worksById = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const allocById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  /** Ocorrência pendente do RDO por serviço|pessoa. */
  const occByKey = useMemo(() => new Map((pendingOcc.data ?? []).map((o) => [`${o.work_id}|${o.collaborator_id}`, o])), [pendingOcc.data]);
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

  /**
   * Clientes exibidos no dia: os que têm MO escalada, mais os que foram exibidos à mão neste dia.
   * Um cliente escondido à mão neste dia fica escondido mesmo com MO.
   */
  const visibleClients = useMemo(() => {
    const manual = new Map((visibility.data ?? []).map((v) => [v.client_id, v.visible]));
    const clientOfWork = new Map(works.map((w) => [w.id, w.client_id]));
    const out = new Set<string>();
    rows.forEach((r: { work_id: string }) => {
      const cid = clientOfWork.get(r.work_id);
      if (cid && manual.get(cid) !== false) out.add(cid);
    });
    manual.forEach((visible, cid) => visible && out.add(cid));
    return out;
  }, [visibility.data, works, rows]);

  /** Quadros exibidos no dia: só os serviços de clientes exibidos. */
  const shownWorks = works.filter((w) => !w.client_id || visibleClients.has(w.client_id));
  /** Uma caixa por cliente: agrupa os serviços do cliente (o serviço de cada pessoa é definido na aba Serviços). */
  const groups = useMemo(() => {
    const m = new Map<string, (typeof shownWorks)[number][]>();
    shownWorks.forEach((w) => {
      const k = w.client_id ?? w.id;
      m.set(k, [...(m.get(k) ?? []), w]);
    });
    return [...m.entries()]
      .map(([key, list]) => {
        const sorted = list.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        const rep = sorted.find((x) => x.active) ?? sorted[0]!;
        return { key, works: sorted, rep, label: rep.clients?.name ?? rep.name };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [works, visibleClients]);
  /**
   * Colaboradores exibidos: os ativos e, além deles, os inativados que já
   * estavam escalados (obra ou caixa) nesta data — some a partir do dia
   * seguinte ao último em que foram escalados.
   */
  const people = useMemo(() => {
    const active = c?.collaborators ?? [];
    const inactive = c?.inactiveCollaborators ?? [];
    if (inactive.length === 0) return active;
    const scheduled = new Set<string>();
    rows.forEach((r) => scheduled.add(r.collaborator_id));
    entries.forEach((e) => scheduled.add(e.collaborator_id));
    return [...active, ...inactive.filter((p) => scheduled.has(p.id))].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, "pt-BR"),
    );
  }, [c, rows, entries]);

  const toggleClientVisible = useMutation({
    mutationFn: async (clientId: string) => {
      // Grava só o que foi mudado à mão: os demais seguem a regra "aparece quem tem MO".
      let payload: { schedule_date: string; client_id: string; visible: boolean }[];
      if (clientId === "__all__") {
        const all = clientOptions.every((cl) => visibleClients.has(cl.id));
        payload = clientOptions.map((cl) => ({ schedule_date: date, client_id: cl.id, visible: !all }));
      } else payload = [{ schedule_date: date, client_id: clientId, visible: !visibleClients.has(clientId) }];
      const { error } = await supabase
        .from("schedule_client_visibility")
        .upsert(payload, { onConflict: "schedule_date,client_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-visibility", date] }),
    onError: onWriteError,
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
  // Aviso prévio (cadastro do colaborador): degradê vermelho discreto da esquerda para a direita a partir do início;
  // depois do fim não pode ser escalado em obras.
  const noticeOf = (id: string) => {
    const p = personById.get(id) as { notice_start?: string | null; notice_end?: string | null } | undefined;
    return p?.notice_start && p.notice_start <= date ? { start: p.notice_start, end: p.notice_end ?? null } : null;
  };
  const noticeClass = (id: string) => (noticeOf(id) ? "bg-gradient-to-r from-destructive/15 via-destructive/[0.04] to-transparent" : "");
  const noticeTitle = (id: string) => {
    const n = noticeOf(id);
    return n ? `Aviso prévio de ${formatDateBR(n.start)}${n.end ? ` a ${formatDateBR(n.end)}` : ""}` : undefined;
  };

  const copyPeopleCpf = (ids: string[]) => {
    const uniq = Array.from(new Set(ids));
    const text = uniq
      .map((id) => personById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => `${p.full_name}\nCPF: ${formatCpf(p.cpf)}`)
      .join("\n\n");
    if (!text) {
      toast.error("Nenhuma pessoa para copiar.");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${uniq.length} pessoa(s) copiada(s).`),
      () => toast.error("Não foi possível copiar."),
    );
  };

  const roleQuery = roleSearch.trim().toLowerCase();
  /** O colaborador atende ao filtro de função digitado? */
  const matchesRole = (collaboratorId: string, positionOverride?: string | null) => {
    if (!roleQuery) return true;
    // Função atual do cadastro tem prioridade sobre a função gravada na alocação.
    const posId = personById.get(collaboratorId)?.position_id ?? positionOverride ?? null;
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
      const w = current ? worksById.get(current.work_id) : undefined;
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

    const notice = noticeOf(collaboratorId);
    if (notice?.end && date > notice.end)
      return base({ level: "block", hardBlock: true, reasons: [`Aviso prévio terminou em ${formatDateBR(notice.end)}`] });

    const work = worksById.get(workId);
    const clientName = work?.clients?.name ?? "cliente";
    const integ = checkIntegration(c as ScheduleContext, workId, collaboratorId, date);
    const requiresInt = workRequiresIntegration(c as ScheduleContext, workId);
    const aso = checkAso(c as ScheduleContext, collaboratorId, date, workId);

    const intBad = integ.status === "expired" || integ.status === "missing";
    const asoBad = requiresInt && (aso.status === "expired" || aso.status === "missing");

    // Sem integração (ou vencida) não bloqueia: vira aviso. ASO continua bloqueando.
    if (asoBad) {
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
      if (asoBad && pendingForWork(c as ScheduleContext, collaboratorId, workId))
        blockers.push("Documento aguardando aceite deste cliente na Conferência");
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
    if (asoBlocksWork(c as ScheduleContext, workId) && aso.status === "expiring")
      warnings.unshift(`ASO vence em ${formatDateBR(aso.expiresAt)}`);
    if (integ.status === "no_client") warnings.unshift("Serviço sem cliente vinculado");
    if (integ.status === "expired") warnings.unshift(`Integração com ${clientName} vencida em ${formatDateBR(integ.expiresAt)}`);
    if (integ.status === "missing") warnings.unshift(`Não possui integração válida com ${clientName}`);
    void intBad;

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
      if (
        selectedWork &&
        !showAll &&
        (ev.level === "block" || ev.hardBlock || ev.integration === "missing" || ev.integration === "expired")
      )
        return false;
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
    // Cria ou devolve a do dia numa só chamada: dois usuários no mesmo dia vazio não batem na chave única.
    const { data, error } = await supabase.rpc("ensure_schedule", { _date: date });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["schedule", date] });
    return data as string;
  }

  function invalidate(id?: string | null) {
    qc.invalidateQueries({ queryKey: ["schedule", date] });
    qc.invalidateQueries({ queryKey: ["allocations", id ?? scheduleId] });
    qc.invalidateQueries({ queryKey: ["status-entries", id ?? scheduleId] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const [clearBox, setClearBox] = useState<{ label: string; ids: string[] } | null>(null);
  const { classify, keepOcc, dropBox, removeEntry, folgaAsk, setFolgaAsk, askRemoveEntry, drop, dropOnGroup, clearRows, removeRow } = usePlannerMutations({
    date, c, rows, entries, personById, allocByCollaborator, allocById, entryById, entryByCollaborator, evaluate,
    ensureSchedule, invalidate, onWriteError, setOccOpen, setClearBox,
  });

  const [confirmCopyPrev, setConfirmCopyPrev] = useState(false);
  const [openFolgas, setOpenFolgas] = useState(false);
  const [openLodging, setOpenLodging] = useState(false);
  function openCopyPrevious() {
    setConfirmCopyPrev(true);
  }
  /** Motivo de não copiar a pessoa no "Copiar dia" (mesmas regras de escalação da Programação). */
  const copySkip = (r: { work_id: string; collaborator_id: string }) => {
    if (!c) return "carregando dados";
    return copySkipReason(r, {
      absence: (id) => c.absences.get(id),
      appointment: (id) => appointmentByCollaborator.get(id),
      box: (id) => { const e = entryByCollaborator.get(id); return e ? boxLabelOf(e.box_key) : null; },
      noticeEnded: (id) => { const n = noticeOf(id); return n?.end && date > n.end ? formatDateBR(n.end) : null; },
      docs: (row) => {
        const out: string[] = [];
        if (workRequiresIntegration(c as ScheduleContext, row.work_id)) {
          const aso = checkAso(c as ScheduleContext, row.collaborator_id, date, row.work_id);
          if (aso.status === "expired") out.push(`ASO vencido em ${formatDateBR(aso.expiresAt)}`);
        }
        for (const i of checkRequirements(c, row.work_id, row.collaborator_id, date)) if (i.blocking && !out.includes(i.label)) out.push(i.label);
        return out;
      },
    });
  };

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

  const namesForWorks = (ids: Set<string>) =>
    Array.from(
      new Set(
        rows
          .filter(
            (r) =>
              ids.has(r.work_id) &&
              matchesRole(r.collaborator_id, r.position_id) &&
              !appointmentByCollaborator.has(r.collaborator_id) &&
              !c?.absences.has(r.collaborator_id),
          )
          .map((r) => personById.get(r.collaborator_id)?.full_name ?? "")
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const copyWorks = (w: (typeof shownWorks)[number], list: (typeof shownWorks)) => {
    const names = namesForWorks(new Set(list.map((x) => x.id)));
    void copyToClipboard([`*${w.clients?.name ?? w.name}*`, dayLine(date), "", names.join("\n")].join("\n"));
  };

  /** Efetivo de cada quadro de cliente (sem ausentes e agendados), em ordem alfabética; só refaz quando os dados mudam. */
  const workRowsByGroup = useMemo(() => {
    const m = new Map<string, PlannerRow[]>();
    const groupOf = new Map<string, string>();
    for (const g of groups) for (const w of g.works) groupOf.set(w.id, g.key);
    for (const r of rows) {
      const k = groupOf.get(r.work_id);
      if (!k || !matchesRole(r.collaborator_id, r.position_id) || appointmentByCollaborator.has(r.collaborator_id) || c?.absences.has(r.collaborator_id)) continue;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    const nameOf = (id: string) => personById.get(id)?.full_name ?? "";
    for (const list of m.values()) list.sort((a, b) => nameOf(a.collaborator_id).localeCompare(nameOf(b.collaborator_id), "pt-BR"));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rows, roleQuery, appointmentByCollaborator, c, personById, positionById]);

  /** Caixas de situação exibidas no dia, com as pessoas lançadas (boxRows) e as das ausências/agendamentos (autoRows). */
  const statusBoxes = useMemo(() => {
    const list = [
      // Integrações (por cliente) logo após as obras
      ...[
        ...new Set([
          ...[...appointmentsByBox.keys()].filter((k) => k.startsWith(INTEGRATION_PREFIX)),
          ...entries.map((e) => e.box_key).filter((k) => k.startsWith(INTEGRATION_PREFIX)),
        ]),
      ]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((key) => ({ key, label: boxLabelOf(key) })),
      ...STATUS_BOXES.filter((b) => b.key !== "integracao").map((b) => ({
        key: b.key as string,
        label: (boxTitles.data?.get(b.key) ?? b.label) as string,
      })),
    ].filter(
      (b) =>
        visibleBoxes.has(b.key) ||
        entries.some((e) => e.box_key === b.key) ||
        (absenceMembers.get(b.key)?.length ?? 0) > 0 ||
        (appointmentsByBox.get(b.key)?.length ?? 0) > 0,
    );
    const nameOf = (id: string) => personById.get(id)?.full_name ?? "";
    const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b), "pt-BR");
    return list.map((b) => {
      const boxRows = entries
        .filter((e) => {
          if (e.box_key !== b.key || !matchesRole(e.collaborator_id)) return false;
          // Ausência cadastrada (ex.: atestado do RH) prevalece sobre a caixa manual.
          const reg = c?.absences.get(e.collaborator_id);
          const regKey = reg ? ABSENCE_BOX[reg] : undefined;
          return !regKey || regKey === b.key;
        })
        .slice()
        .sort((x, y) => byName(x.collaborator_id, y.collaborator_id));
      const inBox = new Set(boxRows.map((r) => r.collaborator_id));
      const autoRows = (absenceMembers.get(b.key) ?? [])
        .filter((a) => matchesRole(a.id) && !inBox.has(a.id))
        .slice()
        .sort((x, y) => byName(x.id, y.id));
      return { b, boxRows, autoRows };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentsByBox, entries, boxTitles.data, visibleBoxes, absenceMembers, personById, roleQuery, c]);

  /** Muda quando algum dado desenhado nos quadros muda: os quadros memorizados redesenham só nessa hora. */
  const dataVersion = [
    date, editable, canClassify, roleQuery, allocations.dataUpdatedAt, statusEntries.dataUpdatedAt, ctx.dataUpdatedAt, pendingOcc.dataUpdatedAt,
    nightToday.dataUpdatedAt, nightCarry.dataUpdatedAt, rdoOrigin.dataUpdatedAt, appointments.dataUpdatedAt, workVt.dataUpdatedAt,
    benefits.workTravel.dataUpdatedAt, benefits.travelRules.dataUpdatedAt, benefits.lodgingStays.dataUpdatedAt, benefits.boxVt.dataUpdatedAt,
    boxTitles.dataUpdatedAt, clearRows.isPending, benefits.toggleBoxTravel.isPending,
  ].join("|");
  const apiRef = useRef<PlannerApi>(null as unknown as PlannerApi);
  apiRef.current = {
    date, rows, allocById, occByKey, ctx: c, pendingOcc: pendingOcc.data ?? [], nightToday: nightToday.data instanceof Set ? (nightToday.data as Set<string>) : new Set<string>(),
    nightCarry: nightCarry.data, rdoOrigin: rdoOrigin.data, personById, positionById, allocByCollaborator, canClassify,
    setSelectedWork, setHoverWork, setHoverBox, setDragging, setEditingBox, setOpenEntry, setOccOpen, setClearBox,
    readPayload, startDrag, dropOnGroup, drop, dropBox, removeRow, clearRows, askRemoveEntry, copyWorks, copyPeopleCpf, buildBoxMessage,
    noticeTitle, noticeClass, lodgingOf, workPaysVt, workPaysTravel, allocVtOn, defaultAllocTravel, travelInfo,
    setGroupVt, setGroupTravel, setGroupOvernight, toggleAllocVt, toggleAllocTravel, toggleOvernight, boxPaysVt, toggleBoxVt, saveBoxTitle,
    travelDot, personBenefits,
  };

  return (
    <div className="space-y-4">
      <AlertDialog open={!!clearBox} onOpenChange={(o) => !o && setClearBox(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirar todos da escalação?</AlertDialogTitle>
            <AlertDialogDescription>
              Os {clearBox?.ids.length} colaborador(es) de “{clearBox?.label}” serão retirados da programação deste dia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={clearRows.isPending} onClick={() => clearBox && clearRows.mutate(clearBox.ids)}>Retirar todos</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!folgaAsk} onOpenChange={(o) => !o && setFolgaAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar da folga</AlertDialogTitle>
            <AlertDialogDescription>
              {folgaAsk?.name} está de folga de {formatDateBR(folgaAsk?.start)} a {formatDateBR(folgaAsk?.end)}. Tirar só deste dia ou a folga inteira?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="outline" disabled={removeEntry.isPending} onClick={() => folgaAsk && removeEntry.mutate({ id: folgaAsk.id, folga: "day" })}>Só deste dia</Button>
            <Button variant="destructive" disabled={removeEntry.isPending} onClick={() => folgaAsk && removeEntry.mutate({ id: folgaAsk.id, folga: "all" })}>A folga inteira</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!copyAsk} onOpenChange={(v) => !v && setCopyAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copiar efetivo</AlertDialogTitle>
            <AlertDialogDescription>
              Este cliente tem mais de um serviço hoje. Deseja copiar só este efetivo ou todos juntos?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => { if (copyAsk) copyWorks(copyAsk.work, [copyAsk.work]); setCopyAsk(null); }}
            >
              Só este efetivo
            </Button>
            <Button
              onClick={() => { if (copyAsk) copyWorks(copyAsk.work, [copyAsk.work, ...copyAsk.siblings]); setCopyAsk(null); }}
            >
              Copiar todos juntos
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CopyDayDialog
        date={date}
        open={confirmCopyPrev}
        onOpenChange={setConfirmCopyPrev}
        currentCount={rows.length}
        workVt={workVt.data}
        skipReason={copySkip}
        hasPending={(r) => !!c && checkRequirements(c, r.work_id, r.collaborator_id, date).length > 0}
        nameOf={(id) => personById.get(id)?.full_name ?? "Colaborador"}
        ensureSchedule={ensureSchedule}
        onCopied={(id) => invalidate(id)}
        onWriteError={onWriteError}
      />
      <RdoAbsenceDialog
        open={!!occOpen}
        onOpenChange={(v) => !v && setOccOpen(null)}
        mode="classify"
        collaboratorName={occOpen ? (personById.get(occOpen.collaborator_id)?.full_name ?? "Colaborador") : ""}
        workName={occOpen ? (() => { const w = c?.worksById.get(occOpen.work_id); return w ? workLabel(w) : ""; })() : ""}
        date={occOpen?.report_date}
        reportedReason={occOpen?.reported_reason}
        reportedNote={occOpen?.reported_note}
        busy={classify.isPending || keepOcc.isPending}
        onConfirm={(key) => occOpen && classify.mutate({ occ: occOpen, key })}
        onKeep={() => occOpen && keepOcc.mutate(occOpen)}
      />
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

        <div className="order-3 flex basis-full flex-wrap items-center gap-2 text-xs">
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

        <div className="order-2 flex flex-wrap gap-2">
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
              <DropdownMenuLabel className="flex items-center justify-between">
                Clientes do dia
                {canWrite && clientOptions.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-normal text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => toggleClientVisible.mutate("__all__")}
                    disabled={toggleClientVisible.isPending}
                  >
                    {clientOptions.every((cl) => visibleClients.has(cl.id)) ? "Limpar" : "Todos"}
                  </button>
                )}
              </DropdownMenuLabel>
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
            <Button size="sm" variant="outline" onClick={openCopyPrevious}>
              <Copy className="h-4 w-4" /> Dia anterior
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpenFolgas(true)}>
            <CalendarDays className="h-4 w-4" /> Folgas
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpenLodging(true)}>
            <BedDouble className="h-4 w-4" /> Alojamentos
          </Button>
          <WeeklyDaysOffDialog date={date} open={openFolgas} onOpenChange={setOpenFolgas} editable={editable} />
          <LodgingDialog date={date} open={openLodging} onOpenChange={setOpenLodging} editable={editable} />
          <ScheduleExportButton date={date} />
          <ScheduleAlertsButton date={date} />
        </div>
        <div className="order-4 basis-full empty:hidden">
          <SchedulePresence date={date} />
        </div>
      </div>

      {(ctx.isLoading || schedule.isLoading) && (
        <p className="text-sm text-muted-foreground">Carregando programação...</p>
      )}

      <div className="grid gap-2 lg:grid-cols-[1fr_252px]">
        {/* Obras */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shownWorks.length === 0 && !ctx.isLoading && (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2">
              {clientOptions.length === 0
                ? "Nenhum cliente com serviço ativo cadastrado."
                : "Nenhum cliente selecionado para este dia. Use o botão \u201cClientes\u201d."}
            </p>
          )}
          {groups.map((g) => (
            <WorkBox
              key={g.key}
              g={g}
              workRows={workRowsByGroup.get(g.key) ?? NO_ROWS}
              selected={selectedWork === g.rep.id}
              isHover={hoverWork === g.rep.id}
              blockedTarget={!!dragging && (() => {
                const e = evaluate(dragging.collaboratorId, g.rep.id, { ignoreEntry: true });
                return e.level === "block" || !!e.hardBlock;
              })()}
              editable={editable}
              version={dataVersion}
              apiRef={apiRef}
            />
          ))}

          {/* Caixas de situação */}
          {statusBoxes.map(({ b, boxRows, autoRows }) => (
            <StatusBox
              key={b.key}
              b={b}
              boxRows={boxRows}
              autoRows={autoRows}
              isHover={hoverBox === b.key}
              editing={editingBox === b.key}
              openEntry={openEntry}
              editable={editable}
              version={dataVersion}
              apiRef={apiRef}
            />
          ))}
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
            if (p.entryId) void askRemoveEntry(p.entryId);
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
                    const w = worksById.get(selectedWork);
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
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                placeholder="Buscar função"
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
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
                  title={noticeTitle(p.id)}
                  className={cn(
                    "text-xs",
                    canDrag ? "cursor-grab active:cursor-grabbing hover:bg-secondary" : "opacity-70",
                    noticeClass(p.id),
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

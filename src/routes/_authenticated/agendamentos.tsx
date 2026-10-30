import { LeaveNotice } from "@/components/leave-notice";
import { findDateConflicts } from "@/lib/date-conflicts";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Check, Minus, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatDateBR, todayISO } from "@/lib/scheduling";
import { normText } from "@/lib/import-helpers";
import type { AppointmentType } from "@/components/appointment-dialog";
import { APPOINTMENT_TYPE_LABEL } from "@/components/appointment-dialog";
import { Tabs as SubTabs, TabsContent as SubTabsContent, TabsList as SubTabsList, TabsTrigger as SubTabsTrigger } from "@/components/ui/tabs";
import { IntegrationsPage } from "@/components/controles/integracoes";
import { TrainingsPage } from "@/components/controles/treinamentos";
import { AsosPage } from "@/components/controles/asos";
import { useControlBadges } from "@/hooks/use-menu-badges";

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({
    meta: [
      { title: "Controles | AB5 Hub" },
      {
        name: "description",
        content:
          "Controle de pendências de ASO, treinamentos e integrações: confirme a realização ou reagende para uma nova data.",
      },
      { property: "og:title", content: "Controles | AB5 Hub" },
      {
        property: "og:description",
        content: "Lista de pendências de ASO, treinamento e integração com confirmação e reagendamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: CtrlTab } =>
    CTRL_TABS.some((t) => t.v === s["tab"]) ? { tab: s["tab"] as CtrlTab } : {},
  component: ControlsPage,
});

const CTRL_TABS = [
  { v: "agendamentos", l: "Agendamentos" },
  { v: "asos", l: "ASOs" },
  { v: "integracoes", l: "Integrações" },
  { v: "treinamentos", l: "Treinamentos" },
] as const;
type CtrlTab = (typeof CTRL_TABS)[number]["v"];

function ControlsPage() {
  const { tab = "agendamentos" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const badges = useControlBadges();
  return (
    <SubTabs value={tab} onValueChange={(v) => navigate({ search: v === "agendamentos" ? {} : { tab: v as CtrlTab }, replace: true })}>
      <SubTabsList>
        {CTRL_TABS.map((t) => {
          const b = badges[t.v];
          return (
            <SubTabsTrigger key={t.v} value={t.v} className="gap-1.5">
              {t.l}
              {b && (
                <span className={`min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}>
                  {b.count > 99 ? "99+" : b.count}
                </span>
              )}
            </SubTabsTrigger>
          );
        })}
      </SubTabsList>
      <SubTabsContent value="agendamentos" className="mt-4"><AppointmentsPage /></SubTabsContent>
      <SubTabsContent value="asos" className="mt-4"><AsosPage /></SubTabsContent>
      <SubTabsContent value="integracoes" className="mt-4"><IntegrationsPage /></SubTabsContent>
      <SubTabsContent value="treinamentos" className="mt-4"><TrainingsPage /></SubTabsContent>
    </SubTabs>
  );
}

type Row = {
  id: string;
  type: AppointmentType;
  collaborator_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  training_id: string | null;
  work_id: string | null;
  client_id: string | null;
  status: string;
  notes: string | null;
  completed_date: string | null;
  completed_time: string | null;
  original_date: string | null;
  original_time: string | null;
  reschedules: unknown;
};

const SELECT_COLS =
  "id, type, collaborator_id, scheduled_date, scheduled_time, training_id, work_id, client_id, status, notes, completed_date, completed_time, original_date, original_time, reschedules";

const hourLabel = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.slice(0, 5).split(":");
  return m === "00" ? `${h}h` : `${h}h${m}`;
};

const addMonths = (iso: string, months: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

type FormState = {
  type: AppointmentType;
  collaborator_id: string;
  scheduled_date: string;
  scheduled_time: string;
  training_id: string;
  client_id: string;
  notes: string;
  pays_transport_voucher: boolean;
};

const emptyForm = (): FormState => ({
  type: "aso",
  collaborator_id: "",
  scheduled_date: todayISO(),
  scheduled_time: "07:00",
  training_id: "",
  client_id: "",
  notes: "",
  pays_transport_voucher: false,
});

function AppointmentsPage() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const today = todayISO();

  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [personQuery, setPersonQuery] = useState("");

  const [doneRow, setDoneRow] = useState<Row | null>(null);
  const [doneDate, setDoneDate] = useState(today);
  const [redoRow, setRedoRow] = useState<Row | null>(null);
  const [redoDate, setRedoDate] = useState(today);
  const [redoTime, setRedoTime] = useState("07:00");
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);

  const [fPeriod, setFPeriod] = useState("all");
  const [fType, setFType] = useState("all");
  const [fWork, setFWork] = useState("all");
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const appointments = useQuery({
    queryKey: ["appointments", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(SELECT_COLS)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const collaborators = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, registration_number")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const trainings = useQuery({
    queryKey: ["trainings-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select("id, name, description, validity_months")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, city, state")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const collabTrainings = useQuery({
    queryKey: ["collab-trainings-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborator_trainings")
        .select("id, collaborator_id, training_id, completed_at, expires_at");
      if (error) throw error;
      return data;
    },
  });

  const asoRecs = useQuery({
    queryKey: ["asos-min-validity"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asos").select("collaborator_id, expires_at").range(0, 9999);
      if (error) throw error;
      return data;
    },
  });

  const integrationRecs = useQuery({
    queryKey: ["integrations-min-validity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_integrations")
        .select("collaborator_id, client_id, expires_at")
        .range(0, 9999);
      if (error) throw error;
      return data;
    },
  });

  const personById = useMemo(() => {
    const m = new Map<string, { full_name: string; registration_number: string }>();
    (collaborators.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [collaborators.data]);

  const trainingById = useMemo(() => {
    const m = new Map<string, { label: string; validity_months: number }>();
    (trainings.data ?? []).forEach((t) =>
      m.set(t.id, {
        label: t.description ? `${t.name} — ${t.description}` : t.name,
        validity_months: t.validity_months,
      }),
    );
    return m;
  }, [trainings.data]);

  const clientById = useMemo(() => {
    const m = new Map<string, string>();
    (clients.data ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients.data]);

  const clientOptions = useMemo(
    () =>
      (clients.data ?? [])
        .map((c) => ({ id: c.id, name: c.city ? `${c.name} · ${c.city}` : c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [clients.data],
  );

  const currentValidity = (collaboratorId: string, trainingId: string | null) => {
    if (!trainingId) return null;
    const recs = (collabTrainings.data ?? []).filter(
      (r) => r.collaborator_id === collaboratorId && r.training_id === trainingId,
    );
    if (recs.length === 0) return null;
    const latest = recs.reduce((a, b) => ((b.expires_at ?? "") > (a.expires_at ?? "") ? b : a));
    return latest;
  };

  const filteredPeople = useMemo(() => {
    const q = normText(personQuery);
    const list = collaborators.data ?? [];
    if (!q) return list.slice(0, 60);
    return list
      .filter((p) => normText(p.full_name).includes(q) || normText(p.registration_number).includes(q))
      .slice(0, 60);
  }, [collaborators.data, personQuery]);

  const rows = useMemo(() => {
    const q = normText(search);
    return (appointments.data ?? []).filter((r) => {
      const pending = r.status === "agendado";
      if (showHistory ? pending : !pending) return false;
      if (fType !== "all" && r.type !== fType) return false;
      if (fWork !== "all" && r.client_id !== fWork) return false;
      if (!showHistory) {
        if (fPeriod === "today" && r.scheduled_date !== today) return false;
        if (fPeriod === "tomorrow" && r.scheduled_date !== addDays(today, 1)) return false;
        if (fPeriod === "week" && (r.scheduled_date < today || r.scheduled_date > addDays(today, 7)))
          return false;
        if (fPeriod === "late" && r.scheduled_date >= today) return false;
      }
      if (q) {
        const p = personById.get(r.collaborator_id);
        const hay = normText(`${p?.full_name ?? ""} ${p?.registration_number ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [appointments.data, fPeriod, fType, fWork, personById, search, showHistory, today]);

  const pendingCount = (appointments.data ?? []).filter((r) => r.status === "agendado").length;
  const lateCount = (appointments.data ?? []).filter(
    (r) => r.status === "agendado" && r.scheduled_date < today,
  ).length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["appointments-day"] });
    qc.invalidateQueries({ queryKey: ["collab-trainings-min"] });
    qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    qc.invalidateQueries({ queryKey: ["asos"] });
    qc.invalidateQueries({ queryKey: ["client-integrations"] });
    qc.invalidateQueries({ queryKey: ["training-records"] });
    qc.invalidateQueries({ queryKey: ["conference"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!form.collaborator_id) throw new Error("Selecione o colaborador");
      if (!form.scheduled_date) throw new Error("Informe a data");
      if (!form.scheduled_time) throw new Error("Informe o horário");
      if (form.type === "treinamento" && !form.training_id) throw new Error("Selecione a NR");
      if (form.type === "integracao" && !form.client_id) throw new Error("Selecione o cliente");
      const conflicts = await findDateConflicts(form.collaborator_id, form.scheduled_date, form.scheduled_date);
      if (conflicts.length) throw new Error(`Não é possível agendar: ${conflicts.join("; ")}`);
      const { error } = await supabase.from("appointments").insert({
        type: form.type,
        collaborator_id: form.collaborator_id,
        scheduled_date: form.scheduled_date,
        scheduled_time: form.scheduled_time,
        original_date: form.scheduled_date,
        original_time: form.scheduled_time,
        training_id: form.type === "treinamento" ? form.training_id : null,
        client_id: form.type === "integracao" ? form.client_id : null,
        work_id: null,
        pays_transport_voucher: form.type === "integracao" ? form.pays_transport_voucher : false,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento criado");
      setOpenNew(false);
      setForm(emptyForm());
      setPersonQuery("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: async ({ row, date }: { row: Row; date: string }) => {
      if (!date) throw new Error("Informe a data real de realização");
      if (row.type === "integracao" && !row.client_id)
        throw new Error("O agendamento não tem cliente vinculado");

      // O cadastro do colaborador (ASO, treinamento, integração) só é atualizado
      // quando o documento for aprovado e concluído na aba Conferência.

      const { error } = await supabase
        .from("appointments")
        .update({
          status: "realizado",
          completed_date: date,
          completed_time: row.scheduled_time,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;


      // Envia o item para a Conferência
      const { data: item, error: itemError } = await supabase
        .from("conference_items")
        .insert({
          appointment_id: row.id,
          collaborator_id: row.collaborator_id,
          type: row.type,
          training_id: row.training_id,
          client_id: row.client_id,
          document_date: date,
          notes: row.notes,
        })
        .select("id")
        .single();
      if (itemError) throw itemError;

      let clientIds: string[] = [];
      if (row.type === "integracao") {
        // Integração: confere somente o cliente do agendamento
        clientIds = row.client_id ? [row.client_id] : [];
      } else {
        const [{ data: integrations }, { data: scheduled }] = await Promise.all([
          supabase.from("client_integrations").select("client_id").eq("collaborator_id", row.collaborator_id),
          // Integrações agendadas também entram: o aceite libera a escalação nesse cliente.
          supabase
            .from("appointments")
            .select("client_id, type")
            .eq("collaborator_id", row.collaborator_id)
            .eq("status", "agendado")
            .not("client_id", "is", null),
        ]);
        clientIds = [
          ...new Set<string>([
            ...(integrations ?? []).map((i) => i.client_id),
            ...(scheduled ?? [])
              .filter((a) => String(a.type).toLowerCase().startsWith("integ"))
              .map((a) => a.client_id as string),
          ]),
        ];
      }
      if (clientIds.length > 0) {
        const { error: checksError } = await supabase
          .from("conference_checks")
          .insert(clientIds.map((client_id) => ({ item_id: item.id, client_id })));
        if (checksError) throw checksError;
      }

    },
    onSuccess: () => {
      toast.success("Realização confirmada e enviada para a Conferência");
      setDoneRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reschedule = useMutation({
    mutationFn: async ({ row, date, time }: { row: Row; date: string; time: string }) => {
      if (!date) throw new Error("Informe a nova data");
      const conflicts = await findDateConflicts(row.collaborator_id, date, date, { table: "appointments", id: row.id });
      if (conflicts.length) throw new Error(`Não é possível remarcar: ${conflicts.join("; ")}`);
      const history = (Array.isArray(row.reschedules) ? row.reschedules : []) as Record<string, string | null>[];
      const nextHistory: Record<string, string | null>[] = [
        ...history,
        { from_date: row.scheduled_date, from_time: row.scheduled_time, at: new Date().toISOString() },
      ];
      const { error } = await supabase
        .from("appointments")
        .update({
          scheduled_date: date,
          scheduled_time: time || row.scheduled_time,
          reschedules: nextHistory,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento remarcado");
      setRedoRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase.from("appointments").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento excluído");
      setDeleteRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const detailOf = (r: Row) => {
    if (r.type === "treinamento") return r.training_id ? trainingById.get(r.training_id)?.label ?? "—" : "—";
    if (r.type === "integracao") return r.client_id ? clientById.get(r.client_id) ?? "—" : "—";
    return "Exame ASO";
  };

  const latestBy = <T extends { expires_at: string | null }>(recs: T[]) =>
    recs.length === 0 ? null : recs.reduce((a, b) => ((b.expires_at ?? "") > (a.expires_at ?? "") ? b : a));

  const validityCell = (r: Row) => {
    let rec: { expires_at: string | null } | null = null;
    if (r.type === "treinamento") rec = currentValidity(r.collaborator_id, r.training_id);
    else if (r.type === "aso")
      rec = latestBy((asoRecs.data ?? []).filter((a) => a.collaborator_id === r.collaborator_id));
    else if (r.type === "integracao")
      rec = latestBy(
        (integrationRecs.data ?? []).filter(
          (a) => a.collaborator_id === r.collaborator_id && a.client_id === r.client_id,
        ),
      );
    if (!rec) return <span className="text-muted-foreground">Não possui</span>;
    if (!rec.expires_at) return <span>Sem validade</span>;
    if (rec.expires_at < today)
      return (
        <span className="font-medium text-destructive">{formatDateBR(rec.expires_at)} — Vencido</span>
      );
    return <span>{formatDateBR(rec.expires_at)}</span>;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agendamentos"
        description="Pendências de ASO, treinamento e integração. Confirme a realização (✓) ou informe uma nova data (X)."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4" /> Novo Agendamento
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="font-display text-2xl">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Atrasados</p>
            <p className="font-display text-2xl text-destructive">{lateCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Exibindo</p>
            <p className="font-display text-2xl">{rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select value={fPeriod} onValueChange={setFPeriod} disabled={showHistory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="tomorrow">Amanhã</SelectItem>
                <SelectItem value="week">Próximos 7 dias</SelectItem>
                <SelectItem value="late">Atrasados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="aso">ASO</SelectItem>
                <SelectItem value="treinamento">Treinamento</SelectItem>
                <SelectItem value="integracao">Integração</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cliente</Label>
            <Select value={fWork} onValueChange={setFWork}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Colaborador</Label>
            <Input
              placeholder="Nome ou matrícula"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant={showHistory ? "default" : "outline"}
              size="sm"
              className="w-full"
              onClick={() => setShowHistory((v) => !v)}
            >
              <CalendarClock className="h-4 w-4" />
              {showHistory ? "Ver pendentes" : "Histórico"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Horário</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>NR / Obra</TableHead>
              <TableHead>Validade</TableHead>
              {showHistory ? <TableHead>Realizado em</TableHead> : <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Nenhum agendamento encontrado.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const p = personById.get(r.collaborator_id);
              const late = r.status === "agendado" && r.scheduled_date < today;
              return (
                <TableRow key={r.id} className={late ? "bg-destructive/5" : undefined}>
                  <TableCell className="whitespace-nowrap text-xs">
                    <div className="flex items-center gap-2">
                      {formatDateBR(r.scheduled_date)}
                      {late && <Badge variant="destructive">Atrasado</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{hourLabel(r.scheduled_time)}</TableCell>
                  <TableCell className="text-xs">{p?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p?.registration_number ?? "—"}</TableCell>
                  <TableCell className="text-xs">{APPOINTMENT_TYPE_LABEL[r.type]}</TableCell>
                  <TableCell className="text-xs">{detailOf(r)}</TableCell>
                  <TableCell className="text-xs">{validityCell(r)}</TableCell>
                  {showHistory ? (
                    <TableCell className="text-xs">
                      {r.completed_date ? formatDateBR(r.completed_date) : "—"}
                      {Array.isArray(r.reschedules) && r.reschedules.length > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          ({r.reschedules.length} reagend.)
                        </span>
                      )}
                    </TableCell>
                  ) : (
                    <TableCell className="text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Marcar como realizado"
                            onClick={() => {
                              setDoneRow(r);
                              setDoneDate(r.scheduled_date);
                            }}
                          >
                            <Check className="h-4 w-4 text-emerald-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Não realizado, reagendar"
                            onClick={() => {
                              setRedoRow(r);
                              setRedoDate(r.scheduled_date);
                              setRedoTime(r.scheduled_time?.slice(0, 5) ?? "07:00");
                            }}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Excluir agendamento"
                            onClick={() => setDeleteRow(r)}
                          >
                            <Minus className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Novo agendamento */}
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Agendamento</DialogTitle>
            <DialogDescription>
              O agendamento aparece automaticamente na Programação Diária na data marcada.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as AppointmentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aso">ASO</SelectItem>
                  <SelectItem value="treinamento">Treinamento</SelectItem>
                  <SelectItem value="integracao">Integração</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Colaborador *</Label>
              <Input
                placeholder="Pesquisar por nome ou matrícula"
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
              />
              <Select value={form.collaborator_id} onValueChange={(v) => set("collaborator_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o colaborador" />
                </SelectTrigger>
                <SelectContent>
                  {filteredPeople.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.registration_number} — {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <LeaveNotice collaboratorId={form.collaborator_id} date={form.scheduled_date} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-date">Data *</Label>
                <Input
                  id="new-date"
                  type="date"
                  value={form.scheduled_date}
                  onChange={(e) => set("scheduled_date", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-time">
                  {form.type === "treinamento" ? "Horário de início *" : "Horário *"}
                </Label>
                <Input
                  id="new-time"
                  type="time"
                  value={form.scheduled_time}
                  onChange={(e) => set("scheduled_time", e.target.value)}
                />
              </div>
            </div>

            {form.type === "treinamento" && (
              <div className="space-y-1.5">
                <Label>NR *</Label>
                <Select value={form.training_id} onValueChange={(v) => set("training_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a NR" />
                  </SelectTrigger>
                  <SelectContent>
                    {(trainings.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.description ? `${t.name} — ${t.description}` : t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.type === "integracao" && (
              <>
                <div className="space-y-1.5">
                  <Label>Cliente *</Label>
                  <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span>Pagar VT para a pessoa</span>
                  <Switch
                    checked={form.pays_transport_voucher}
                    onCheckedChange={(v) => set("pays_transport_voucher", v)}
                  />
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="new-notes">Observação</Label>
                  <Textarea
                    id="new-notes"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancelar
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar realização */}
      <Dialog open={!!doneRow} onOpenChange={(v) => !v && setDoneRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar realização?</DialogTitle>
            <DialogDescription>
              {doneRow
                ? `${personById.get(doneRow.collaborator_id)?.full_name ?? ""} — ${detailOf(doneRow)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="done-date">Data real de realização</Label>
            <Input
              id="done-date"
              type="date"
              value={doneDate}
              onChange={(e) => setDoneDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A validade é calculada a partir desta data.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDoneRow(null)}>
              Cancelar
            </Button>
            <Button
              disabled={complete.isPending}
              onClick={() => doneRow && complete.mutate({ row: doneRow, date: doneDate })}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reagendar */}
      <Dialog open={!!redoRow} onOpenChange={(v) => !v && setRedoRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendamento não realizado</DialogTitle>
            <DialogDescription>Informe a nova data e horário. O agendamento continua pendente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="redo-date">Nova data</Label>
              <Input id="redo-date" type="date" value={redoDate} onChange={(e) => setRedoDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="redo-time">Novo horário</Label>
              <Input id="redo-time" type="time" value={redoTime} onChange={(e) => setRedoTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRedoRow(null)}>
              Cancelar
            </Button>
            <Button
              disabled={reschedule.isPending}
              onClick={() => redoRow && reschedule.mutate({ row: redoRow, date: redoDate, time: redoTime })}
            >
              Reagendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir agendamento */}
      <AlertDialog open={!!deleteRow} onOpenChange={(v) => !v && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow
                ? `${APPOINTMENT_TYPE_LABEL[deleteRow.type]} — ${personById.get(deleteRow.collaborator_id)?.full_name ?? ""} em ${formatDateBR(deleteRow.scheduled_date)}. Esta ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) remove.mutate(deleteRow);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateBR, todayISO } from "@/lib/scheduling";

export type AppointmentType = "aso" | "treinamento" | "integracao";

export const APPOINTMENT_TYPE_LABEL: Record<AppointmentType, string> = {
  aso: "ASO",
  treinamento: "Treinamento",
  integracao: "Integração",
};

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
};

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
};

type FormState = {
  collaborator_id: string;
  scheduled_date: string;
  scheduled_time: string;
  training_id: string;
  client_id: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  collaborator_id: "",
  scheduled_date: todayISO(),
  scheduled_time: "07:00",
  training_id: "",
  client_id: "",
  notes: "",
});

type AppointmentDialogProps = {
  type: AppointmentType;
  /** Mostra só um ícone de calendário (para usar na linha de um colaborador). */
  iconOnly?: boolean;
  initialValues?: Partial<Pick<FormState, "collaborator_id" | "training_id" | "client_id">>;
};

export function AppointmentDialog({ type, iconOnly, initialValues }: AppointmentDialogProps) {
  const { canWrite, isAdmin } = useCurrentUser();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fPerson, setFPerson] = useState("all");
  const [fStatus, setFStatus] = useState("agendado");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const appointments = useQuery({
    queryKey: ["appointments", type],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, type, collaborator_id, scheduled_date, scheduled_time, training_id, work_id, client_id, status, notes")
        .eq("type", type)
        .order("scheduled_date", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  const collaborators = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, registration_number, position_id")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const trainings = useQuery({
    queryKey: ["trainings-min"],
    enabled: type === "treinamento",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select("id, name, description")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useQuery({
    queryKey: ["clients-min"],
    enabled: type === "integracao",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, city")
        .order("name");
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
    const m = new Map<string, string>();
    (trainings.data ?? []).forEach((t) => m.set(t.id, t.description ? `${t.name} — ${t.description}` : t.name));
    return m;
  }, [trainings.data]);

  const clientById = useMemo(() => {
    const m = new Map<string, string>();
    (clients.data ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients.data]);

  const filteredPeople = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    const list = collaborators.data ?? [];
    if (!q) return list.slice(0, 80);
    return list
      .filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) || p.registration_number.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [collaborators.data, personQuery]);

  const rows = useMemo(() => {
    return (appointments.data ?? []).filter((r) => {
      if (fFrom && r.scheduled_date < fFrom) return false;
      if (fTo && r.scheduled_date > fTo) return false;
      if (fPerson !== "all" && r.collaborator_id !== fPerson) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      return true;
    });
  }, [appointments.data, fFrom, fTo, fPerson, fStatus]);

  const reset = () => {
    setForm(emptyForm());
    setEditing(null);
    setPersonQuery("");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.collaborator_id) throw new Error("Selecione o colaborador");
      if (!form.scheduled_date) throw new Error("Informe a data do agendamento");
      if (!form.scheduled_time) throw new Error("Informe o horário do agendamento");
      if (type === "treinamento" && !form.training_id) throw new Error("Selecione o treinamento (NR)");
      if (type === "integracao" && !form.client_id) throw new Error("Selecione o cliente");
      const payload = {
        type,
        collaborator_id: form.collaborator_id,
        scheduled_date: form.scheduled_date,
        scheduled_time: form.scheduled_time,
        training_id: type === "treinamento" ? form.training_id : null,
        client_id: type === "integracao" ? form.client_id : null,
        work_id: null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("appointments").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Agendamento atualizado" : "Agendamento criado");
      reset();
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments-day"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments-day"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento excluído");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments-day"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (r: Row) => {
    setEditing(r);
    setForm({
      collaborator_id: r.collaborator_id,
      scheduled_date: r.scheduled_date,
      scheduled_time: r.scheduled_time?.slice(0, 5) ?? "07:00",
      training_id: r.training_id ?? "",
      client_id: r.client_id ?? "",
      notes: r.notes ?? "",
    });
  };

  return (
    <>
      {iconOnly ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Agendar"
          title="Agendar"
          onClick={() => {
            setForm({ ...emptyForm(), ...initialValues });
            setFPerson(initialValues?.collaborator_id ?? "all");
            setOpen(true);
          }}
        >
          <CalendarClock className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <CalendarClock className="h-4 w-4" /> Agendamento
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agendamento de {APPOINTMENT_TYPE_LABEL[type]}</DialogTitle>
            <DialogDescription>
              Os agendamentos aparecem automaticamente na Programação Diária na data marcada.
            </DialogDescription>
          </DialogHeader>

          {canWrite && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
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

                <div className="space-y-1.5">
                  <Label htmlFor="appt-date">Data do agendamento *</Label>
                  <Input
                    id="appt-date"
                    type="date"
                    value={form.scheduled_date}
                    onChange={(e) => set("scheduled_date", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="appt-time">
                    {type === "treinamento" ? "Horário de início *" : "Horário *"}
                  </Label>
                  <Input
                    id="appt-time"
                    type="time"
                    value={form.scheduled_time}
                    onChange={(e) => set("scheduled_time", e.target.value)}
                  />
                </div>

                {type === "treinamento" && (
                  <div className="space-y-1.5">
                    <Label>Treinamento (NR) *</Label>
                    <Select value={form.training_id} onValueChange={(v) => set("training_id", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o treinamento" />
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

                {type === "integracao" && (
                  <div className="space-y-1.5">
                    <Label>Cliente *</Label>
                    <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {(clients.data ?? []).map((cl) => (
                          <SelectItem key={cl.id} value={cl.id}>
                            {cl.city ? `${cl.name} · ${cl.city}` : cl.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="appt-notes">Observações</Label>
                  <Textarea
                    id="appt-notes"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  <Plus className="h-4 w-4" /> {editing ? "Salvar alterações" : "Agendar"}
                </Button>
                {editing && (
                  <Button size="sm" variant="ghost" onClick={reset}>
                    Cancelar edição
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Colaborador</Label>
              <Select value={fPerson} onValueChange={setFPerson}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(collaborators.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Situação</Label>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                  <SelectItem value="realizado">Realizado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>{type === "treinamento" ? "Treinamento" : type === "integracao" ? "Cliente" : "Tipo"}</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Nenhum agendamento encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => {
                  const p = personById.get(r.collaborator_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateBR(r.scheduled_date)}</TableCell>
                      <TableCell className="text-xs">{p?.registration_number ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {type === "treinamento"
                          ? (r.training_id ? trainingById.get(r.training_id) : null) ?? "—"
                          : type === "integracao"
                            ? (r.client_id ? clientById.get(r.client_id) : null) ?? "—"
                            : "Exame ASO"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "realizado"
                              ? "default"
                              : r.status === "cancelado"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {APPOINTMENT_STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Editar agendamento"
                              onClick={() => startEdit(r)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {r.status !== "realizado" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Marcar como realizado"
                                onClick={() => setStatus.mutate({ id: r.id, status: "realizado" })}
                              >
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              </Button>
                            )}
                            {r.status !== "cancelado" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Cancelar agendamento"
                                onClick={() => setStatus.mutate({ id: r.id, status: "cancelado" })}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Excluir agendamento"
                                onClick={() => remove.mutate(r.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

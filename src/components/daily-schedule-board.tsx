import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  addDays,
  checkRequirements,
  fetchScheduleContext,
  formatBR,
  todayISO,
} from "@/lib/scheduling";

const NONE = "__none__";

type AllocationPatch = {
  confirmation_status?: "confirmed" | "pending";
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  overnight?: boolean;
};


const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  in_progress: "Em andamento",
  finalized: "Finalizada",
};

type FormState = {
  work_id: string;
  collaborator_id: string;
  position_id: string;
  vehicle_id: string;
  driver: boolean;
  notes: string;
};

const emptyForm: FormState = {
  work_id: "",
  collaborator_id: "",
  position_id: NONE,
  vehicle_id: NONE,
  driver: false,
  notes: "",
};

export function DailyScheduleBoard({
  date,
  onDateChange,
  allowFinalize = true,
}: {
  date: string;
  onDateChange?: (d: string) => void;
  allowFinalize?: boolean;
}) {
  const { canWrite, isAdmin, user } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

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

  const rows = allocations.data ?? [];
  const c = ctx.data;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (c?.collaborators ?? []).forEach((p) => m.set(p.id, p.full_name));
    return m;
  }, [c]);
  const positionById = useMemo(() => {
    const m = new Map<string, string>();
    (c?.positions ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [c]);
  const vehicleById = useMemo(() => {
    const m = new Map<string, string>();
    (c?.vehicles ?? []).forEach((v) => m.set(v.id, `${v.plate}${v.model ? " · " + v.model : ""}`));
    return m;
  }, [c]);

  const usedWorks = useMemo(() => {
    const ids = new Set(rows.map((r) => r.work_id));
    return (c?.works ?? []).filter((w) => ids.has(w.id));
  }, [rows, c]);

  const allocatedIds = useMemo(() => new Set(rows.map((r) => r.collaborator_id)), [rows]);

  const available = useMemo(
    () => (c?.collaborators ?? []).filter((p) => !c?.absences.has(p.id) && !allocatedIds.has(p.id)),
    [c, allocatedIds],
  );

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
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const createSchedule = useMutation({
    mutationFn: ensureSchedule,
    onSuccess: () => toast.success("Programação criada"),
    onError: (e: Error) => toast.error(e.message),
  });

  const generateFromBase = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error("Carregando dados");
      const id = await ensureSchedule();
      const existing = new Set(rows.map((r) => `${r.work_id}:${r.collaborator_id}`));
      const inserts = c.baseTeams
        .filter((b) => !c.absences.has(b.collaborator_id))
        .filter((b) => !existing.has(`${b.work_id}:${b.collaborator_id}`))
        .filter((b) => c.collaborators.some((p) => p.id === b.collaborator_id))
        .map((b, i) => {
          const issues = checkRequirements(c, b.work_id, b.collaborator_id, date);
          return {
            schedule_id: id,
            work_id: b.work_id,
            collaborator_id: b.collaborator_id,
            position_id: b.position_id,
            driver: false,
            source: "base_team" as const,
            confirmation_status: "pending" as const,
            has_pending_requirement: issues.length > 0,
            sort_order: rows.length + i,
          };
        });
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
      const existing = new Set(rows.map((r) => `${r.work_id}:${r.collaborator_id}`));
      const inserts = prevRows
        .filter((r) => !c.absences.has(r.collaborator_id))
        .filter((r) => !existing.has(`${r.work_id}:${r.collaborator_id}`))
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

  const addAllocation = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error("Carregando dados");
      if (!form.work_id) throw new Error("Selecione a obra");
      if (!form.collaborator_id) throw new Error("Selecione o colaborador");
      const absence = c.absences.get(form.collaborator_id);
      if (absence) throw new Error(`Colaborador indisponível: ${absence}`);
      if (allocatedIds.has(form.collaborator_id))
        throw new Error("Colaborador já está alocado nesta data");

      const issues = checkRequirements(c, form.work_id, form.collaborator_id, date);
      const blocking = issues.filter((i) => i.blocking);
      if (blocking.length > 0)
        throw new Error("Requisito bloqueante não atendido: " + blocking.map((b) => b.label).join(", "));

      const id = await ensureSchedule();
      const { error } = await supabase.from("daily_allocations").insert({
        schedule_id: id,
        work_id: form.work_id,
        collaborator_id: form.collaborator_id,
        position_id: form.position_id === NONE ? null : form.position_id,
        vehicle_id: form.vehicle_id === NONE ? null : form.vehicle_id,
        driver: form.driver,
        source: "manual",
        confirmation_status: "pending",
        has_pending_requirement: issues.length > 0,
        sort_order: rows.length,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
      return { id, warn: issues.length > 0 ? issues.map((i) => i.label).join(", ") : null };
    },
    onSuccess: (r) => {
      toast.success("Colaborador alocado");
      if (r.warn) toast.warning("Pendência de requisito: " + r.warn);
      setOpen(false);
      setForm({ ...emptyForm, work_id: form.work_id });
      invalidate(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRow = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AllocationPatch }) => {
      const { error } = await supabase.from("daily_allocations").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alocação removida");
      invalidate();
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

  const confirmedCount = rows.filter((r) => r.confirmation_status === "confirmed").length;
  const pendingReq = rows.filter((r) => r.has_pending_requirement).length;

  return (
    <div className="space-y-4">
      {/* Barra de data e ações */}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        {onDateChange ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => onDateChange(addDays(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => e.target.value && onDateChange(e.target.value)}
            />
            <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => onDateChange(addDays(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDateChange(todayISO())}>
              Hoje
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium capitalize">{formatBR(date)}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={finalized ? "default" : "secondary"}>
            {schedule.data ? STATUS_LABEL[schedule.data.status] : "Não iniciada"}
          </Badge>
          <Badge variant="outline">
            <Users className="mr-1 h-3 w-3" /> {rows.length} alocados
          </Badge>
          <Badge variant="outline">
            <Check className="mr-1 h-3 w-3" /> {confirmedCount} confirmados
          </Badge>
          {pendingReq > 0 && (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" /> {pendingReq} com pendência
            </Badge>
          )}
          {c?.holiday && <Badge variant="secondary">Feriado: {c.holiday}</Badge>}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && !schedule.data && (
            <Button size="sm" onClick={() => createSchedule.mutate()} disabled={createSchedule.isPending}>
              <Plus className="h-4 w-4" /> Criar programação
            </Button>
          )}
          {editable && (
            <>
              <Button size="sm" variant="outline" onClick={() => generateFromBase.mutate()} disabled={generateFromBase.isPending}>
                <Users className="h-4 w-4" /> Equipes base
              </Button>
              <Button size="sm" variant="outline" onClick={() => copyPrevious.mutate()} disabled={copyPrevious.isPending}>
                <Copy className="h-4 w-4" /> Copiar dia anterior
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setForm({ ...emptyForm, work_id: usedWorks[0]?.id ?? "" });
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Alocar
              </Button>
            </>
          )}
          {allowFinalize && canWrite && schedule.data && (
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

      {!schedule.isLoading && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhuma alocação nesta data. Use "Equipes base" ou "Copiar dia anterior" para começar.
        </p>
      )}

      {/* Quadro por obra */}
      <div className="grid gap-4 xl:grid-cols-2">
        {usedWorks.map((w) => {
          const workRows = rows.filter((r) => r.work_id === w.id);
          return (
            <section key={w.id} className="panel overflow-hidden">
              <header className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/60 px-4 py-3">
                <div>
                  <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                    {w.code} — {w.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {[w.city, w.entry_time?.slice(0, 5) && `Entrada ${w.entry_time.slice(0, 5)}`, w.distance_km && `${w.distance_km} km`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge variant="outline" className="ml-auto">
                  {workRows.length} pessoa(s)
                </Badge>
              </header>
              <ul className="divide-y divide-border">
                {workRows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {nameById.get(r.collaborator_id) ?? "—"}
                        {r.driver && <Badge variant="secondary" className="ml-2">Motorista</Badge>}
                        {r.has_pending_requirement && (
                          <Badge variant="destructive" className="ml-2">
                            <AlertTriangle className="mr-1 h-3 w-3" /> Pendência
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          r.position_id ? positionById.get(r.position_id) : null,
                          r.vehicle_id ? vehicleById.get(r.vehicle_id) : null,
                          r.notes,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <Button
                      variant={r.overnight ? "secondary" : "ghost"}
                      size="sm"
                      disabled={!editable}
                      title="Pernoite (dorme fora)"
                      onClick={() => updateRow.mutate({ id: r.id, patch: { overnight: !r.overnight } })}
                    >
                      {r.overnight ? "Pernoite ✓" : "Pernoite"}
                    </Button>
                    <Button
                      variant={r.confirmation_status === "confirmed" ? "default" : "outline"}
                      size="sm"
                      disabled={!editable}
                      onClick={() =>
                        updateRow.mutate({
                          id: r.id,
                          patch:
                            r.confirmation_status === "confirmed"
                              ? { confirmation_status: "pending", confirmed_by: null, confirmed_at: null }
                              : {
                                  confirmation_status: "confirmed",
                                  confirmed_by: user?.id ?? null,
                                  confirmed_at: new Date().toISOString(),
                                },
                        })
                      }
                    >
                      <Check className="h-4 w-4" />
                      {r.confirmation_status === "confirmed" ? "Confirmado" : "Confirmar"}
                    </Button>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover alocação"
                        onClick={() => removeRow.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Indisponíveis do dia */}
      {c && c.absences.size > 0 && (
        <div className="panel p-4">
          <h3 className="font-display text-sm uppercase tracking-wide">Indisponíveis nesta data</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...c.absences.entries()].map(([id, reason]) => (
              <Badge key={id} variant="secondary">
                {nameById.get(id) ?? id} · {reason}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alocar colaborador</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Obra *</Label>
              <Select value={form.work_id} onValueChange={(v) => set("work_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(c?.works ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Colaborador disponível *</Label>
              <Select value={form.collaborator_id} onValueChange={(v) => set("collaborator_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name} {p.is_driver ? "· motorista" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.work_id && form.collaborator_id && c && (
                <RequirementHint ctx={c} workId={form.work_id} collaboratorId={form.collaborator_id} date={date} />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Função no dia</Label>
                <Select value={form.position_id} onValueChange={(v) => set("position_id", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Usar cargo do colaborador</SelectItem>
                    {(c?.positions ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Veículo</Label>
                <Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem veículo</SelectItem>
                    {(c?.vehicles ?? [])
                      .filter((v) => v.status === "available" || v.status === "in_use")
                      .map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.plate} {v.model ? `· ${v.model}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label>Motorista do dia</Label>
                <p className="text-xs text-muted-foreground">Marque se este colaborador vai dirigir.</p>
              </div>
              <Switch checked={form.driver} onCheckedChange={(v) => set("driver", v)} />
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => addAllocation.mutate()} disabled={addAllocation.isPending}>
              {addAllocation.isPending ? "Salvando..." : "Alocar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequirementHint({
  ctx,
  workId,
  collaboratorId,
  date,
}: {
  ctx: Parameters<typeof checkRequirements>[0];
  workId: string;
  collaboratorId: string;
  date: string;
}) {
  const issues = checkRequirements(ctx, workId, collaboratorId, date);
  if (issues.length === 0)
    return <p className="text-xs text-muted-foreground">Todos os requisitos da obra atendidos.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {issues.map((i) => (
        <li key={i.label} className={i.blocking ? "text-destructive" : "text-muted-foreground"}>
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {i.label} {i.blocking ? "(bloqueante)" : "(alerta)"}
        </li>
      ))}
    </ul>
  );
}

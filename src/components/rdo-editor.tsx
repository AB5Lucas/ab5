import { useEffect, useMemo, useState } from "react";
import { normalizePhoto, rotatePhoto, getMediaReversed, setMediaReversed } from "@/lib/rdo-images";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpDown, RotateCw,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileDown,
  ImagePlus,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  Video,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { RdoAbsenceDialog } from "@/components/rdo-absence-dialog";
import { SignaturePad } from "@/components/signature-pad";
import { RDO_STATUS_LABEL, SCAFFOLD_OPS, SERVICE_CATEGORIES, reasonLabel, workedHours, positionLabel } from "@/lib/rdo";
import { exportRdoPdf } from "@/lib/rdo-pdf";
import { useCurrentUser } from "@/hooks/use-auth";

/** Horário padrão do turno noturno (entra num dia, sai no outro). */
const NIGHT_ENTRY = "21:30";
const NIGHT_EXIT = "05:30";

const STEPS = ["Efetivo", "Atividades", "Fotos e vídeos", "Observações", "Assinaturas", "Finalizar"] as const;

type WorkRow = {
  id: string;
  name: string;
  client_id: string | null;
  entry_time: string | null;
  exit_time: string | null;
  exit_time_weekend: string | null;
  clients: { name: string } | null;
  rdo_general?: boolean;
};

export const workLabel = (w: { name: string; clients: { name: string } | null }) =>
  w.clients?.name ? `${w.clients.name} - ${w.name}` : w.name;

/** Cria/sincroniza o RDO da obra+data com a Programação e mostra o preenchimento por etapas. */
export function RdoEditor({ work, date }: { work: WorkRow; date: string }) {
  const qc = useQueryClient();
  const { user, profile, canWrite, isCliente } = useCurrentUser();
  const [step, setStep] = useState(0);

  const rdo = useQuery({
    queryKey: ["rdo", work.id, date],
    queryFn: async () => {
      const { data } = await supabase.from("rdos").select("*").eq("work_id", work.id).eq("report_date", date).maybeSingle();
      return data;
    },
  });

  const planned = useQuery({
    queryKey: ["rdo-planned", work.id, date],
    queryFn: async () => {
      const { data: s } = await supabase.from("daily_schedules").select("id").eq("schedule_date", date).maybeSingle();
      // RDO Geral do cliente: reúne o efetivo de todos os serviços do cliente.
      const general = !!work.rdo_general && !!work.client_id;
      const scopeIds = general
        ? ((await supabase.from("works").select("id").eq("client_id", work.client_id!)).data ?? []).map((w) => w.id)
        : [work.id];
      // Quem faz integração no cliente desta obra no dia também entra no RDO dela.
      const { data: integ } = await supabase.from("appointments").select("collaborator_id, work_id, collaborators(position_id)")
        .eq("type", "integracao").eq("scheduled_date", date).neq("status", "cancelado")
        .or(general ? `client_id.eq.${work.client_id},work_id.in.(${scopeIds.join(",")})` : work.client_id ? `work_id.eq.${work.id},and(work_id.is.null,client_id.eq.${work.client_id})` : `work_id.eq.${work.id}`);
      const integAllocs = (integ ?? []).filter((a) => a.collaborator_id).map((a) => ({ id: null as unknown as string, collaborator_id: a.collaborator_id!, position_id: null as string | null, collaborators: (a.collaborators as { position_id: string | null } | null) ?? null, lastPos: null as string | null }));
      const integIds = new Set(integAllocs.map((a) => a.collaborator_id));
      if (!s) return { scheduleId: null as string | null, blocked: new Set<string>(), allocs: integAllocs as { id: string; collaborator_id: string; position_id: string | null; collaborators: { position_id: string | null } | null; lastPos: string | null }[] };
      const { data: raw } = await supabase
        .from("daily_allocations")
        .select("id, collaborator_id, position_id, collaborators(position_id)")
        .eq("schedule_id", s.id)
        .in("work_id", scopeIds);
      // Quem está de folga, férias ou atestado no dia não entra no RDO (a ausência prevalece).
      const ids = (raw ?? []).map((a) => a.collaborator_id);
      const blocked = new Set<string>();
      if (ids.length) {
        const [off, vac, med, appt, boxes] = await Promise.all([
          supabase.from("days_off").select("collaborator_id, date, end_date").in("collaborator_id", ids).lte("date", date),
          supabase.from("vacations").select("collaborator_id").in("collaborator_id", ids).lte("start_date", date).gte("end_date", date).neq("status", "cancelled"),
          supabase.from("medical_leaves").select("collaborator_id").in("collaborator_id", ids).lte("start_date", date).gte("end_date", date),
          // Escalado para integração/treinamento no dia: sai do RDO da obra
          supabase.from("appointments").select("collaborator_id").in("collaborator_id", ids).in("type", ["integracao", "treinamento"]).eq("scheduled_date", date).neq("status", "cancelado"),
          supabase.from("daily_status_entries").select("collaborator_id, box_key").eq("schedule_id", s.id).in("collaborator_id", ids),
        ]);
        for (const o of off.data ?? []) if ((o.end_date ?? o.date) >= date) blocked.add(o.collaborator_id);
        for (const v of vac.data ?? []) blocked.add(v.collaborator_id);
        for (const m of med.data ?? []) blocked.add(m.collaborator_id);
        for (const a of appt.data ?? []) if (a.collaborator_id && !integIds.has(a.collaborator_id)) blocked.add(a.collaborator_id);
        for (const b of boxes.data ?? []) if ((b.box_key === "treinamento" || b.box_key.startsWith("integracao")) && !integIds.has(b.collaborator_id)) blocked.add(b.collaborator_id);
      }
      const allocated = [...new Map((raw ?? []).filter((a) => !blocked.has(a.collaborator_id)).map((a) => [a.collaborator_id, a])).values()];
      const have = new Set(allocated.map((a) => a.collaborator_id));
      const data = [...allocated, ...integAllocs.filter((a) => !have.has(a.collaborator_id))];
      // Última função usada no RDO deste serviço (mantida para os próximos RDOs)
      const { data: prev } = await supabase
        .from("rdo_workforce")
        .select("collaborator_id, position_id, report_date")
        .eq("work_id", work.id)
        .lt("report_date", date)
        .not("position_id", "is", null)
        .order("report_date", { ascending: false })
        .limit(1000);
      const lastPos: Record<string, string> = {};
      for (const p of prev ?? []) if (!lastPos[p.collaborator_id]) lastPos[p.collaborator_id] = p.position_id!;
      return { scheduleId: s.id as string | null, blocked, allocs: data.map((a) => ({ ...a, lastPos: lastPos[a.collaborator_id] ?? null })) };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: nw } = await (supabase as any)
        .from("schedule_work_night")
        .select("id")
        .eq("schedule_date", date)
        .eq("work_id", work.id)
        .maybeSingle();
      const { error } = await supabase.from("rdos").insert({
        work_id: work.id,
        client_id: work.client_id,
        report_date: date,
        schedule_id: planned.data?.scheduleId ?? null,
        user_id: user?.id ?? null,
        responsible_name: profile?.full_name || profile?.email || null,
        shift: nw ? "night" : "day",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rdo", work.id, date] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const r = rdo.data;
  const editable = !!r && !isCliente && (r.status === "draft" || canWrite);

  const defaultTimes = useMemo(() => {
    if (r?.shift === "night") return { entry: NIGHT_ENTRY, exit: NIGHT_EXIT };
    const wd = new Date(date + "T12:00:00").getDay();
    const exit = (wd === 0 || wd === 5 || wd === 6) && work.exit_time_weekend ? work.exit_time_weekend : work.exit_time;
    return { entry: work.entry_time?.slice(0, 5) ?? "07:00", exit: exit?.slice(0, 5) ?? "17:00" };
  }, [date, work, r?.shift]);

  const team = useQuery({
    queryKey: ["rdo-team", r?.id],
    enabled: !!r?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("rdo_workforce")
        .select("*, collaborators(full_name, registration_number), positions(name)")
        .eq("rdo_id", r!.id);
      return (data ?? []).sort((a, b) =>
        (a.collaborators?.full_name ?? "").localeCompare(b.collaborators?.full_name ?? "", "pt-BR"),
      );
    },
  });

  // Sincroniza com a Programação enquanto o RDO está em rascunho (sem duplicar).
  useEffect(() => {
    if (!r || r.status !== "draft" || !team.data || !planned.data || !editable) return;
    const have = new Map(team.data.map((t) => [t.collaborator_id, t]));
    const allocIds = new Set(planned.data.allocs.map((a) => a.collaborator_id));
    const inserts = planned.data.allocs
      .filter((a) => !have.has(a.collaborator_id))
      .map((a) => ({
        rdo_id: r.id,
        work_id: work.id,
        report_date: date,
        collaborator_id: a.collaborator_id,
        allocation_id: a.id,
        position_id: a.lastPos ?? a.position_id ?? a.collaborators?.position_id ?? null,
        planned: true,
        entry_time: defaultTimes.entry,
        exit_time: defaultTimes.exit,
      }));
    const removed = team.data
      .filter((t) => t.planned && !allocIds.has(t.collaborator_id) && ((t.present && t.occurrence_status === "none") || planned.data!.blocked.has(t.collaborator_id)))
      .map((t) => t.id);
    if (!inserts.length && !removed.length) return;
    (async () => {
      if (inserts.length) await supabase.from("rdo_workforce").upsert(inserts, { onConflict: "rdo_id,collaborator_id", ignoreDuplicates: true });
      if (removed.length) await supabase.from("rdo_workforce").delete().in("id", removed);
      qc.invalidateQueries({ queryKey: ["rdo-team", r.id] });
    })();
  }, [r, team.data, planned.data, editable, defaultTimes, date, work.id, qc]);

  const updateRdo = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("rdos").update(patch as never).eq("id", r!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rdo", work.id, date] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (rdo.isLoading || planned.isLoading) return <p className="p-4 text-sm text-muted-foreground">Carregando...</p>;

  if (!r) {
    return (
      <div className="panel space-y-3 p-5 text-center">
        <p className="font-display text-lg uppercase">Nenhum RDO para este dia</p>
        <p className="text-sm text-muted-foreground">
          Programação do dia: <b>{planned.data?.allocs.length ?? 0}</b> colaborador(es) escalado(s) nesta obra.
        </p>
        {!isCliente && (
          <Button size="lg" className="w-full sm:w-auto" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="h-5 w-5" /> Criar RDO
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm">RDO Nº {String(r.number ?? "").padStart(4, "0")}</span>
        <Badge variant={r.status === "draft" ? "secondary" : "default"}>{RDO_STATUS_LABEL[r.status] ?? r.status}</Badge>
        <Select value={r.shift ?? "day"} onValueChange={async (v) => {
          updateRdo.mutate({ shift: v });
          const wd = new Date(date + "T12:00:00").getDay();
          const dayExit = (wd === 0 || wd === 5 || wd === 6) && work.exit_time_weekend ? work.exit_time_weekend : work.exit_time;
          const t = v === "night" ? { entry_time: NIGHT_ENTRY, exit_time: NIGHT_EXIT } : { entry_time: work.entry_time?.slice(0, 5) ?? "07:00", exit_time: dayExit?.slice(0, 5) ?? "17:00" };
          await supabase.from("rdo_workforce").update(t).eq("rdo_id", r.id);
          qc.invalidateQueries({ queryKey: ["rdo-team", r.id] });
        }} disabled={!editable}>
          <SelectTrigger className="h-8 w-auto text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Turno Diurno</SelectItem>
            <SelectItem value="night">Turno Noturno</SelectItem>
          </SelectContent>
        </Select>
        {r.responsible_name && <span className="text-xs text-muted-foreground">Responsável: {r.responsible_name}</span>}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => toast.promise(exportRdoPdf(r.id), { loading: "Gerando PDF...", success: "PDF gerado", error: (e) => e.message })}
        >
          <FileDown className="h-4 w-4" /> Exportar RDO
        </Button>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium",
              i === step ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {i + 1}. {s}
          </button>
        ))}
      </nav>

      {!editable && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> RDO finalizado — somente consulta.
        </p>
      )}

      <div className="panel p-3 sm:p-4">
        {step === 0 && <TeamStep rdoId={r.id} night={r.shift === "night"} work={work} date={date} rows={team.data ?? []} editable={editable} />}
        {step === 1 && (
          <div className="space-y-4">
            <TextStep
              label="Atividades realizadas no dia"
              value={r.activities ?? ""}
              editable={editable}
              onSave={(v) => updateRdo.mutate({ activities: v })}
            />
            <ServicesStep rdoId={r.id} editable={editable} onlyScaffolds />
          </div>
        )}
        {step === 2 && <MediaStep rdoId={r.id} editable={editable} />}
        {step === 3 && (
          <TextStep
            label="Observações"
            placeholder="Problemas, atrasos, falta de material, interferências, solicitações do cliente..."
            value={r.notes ?? ""}
            editable={editable}
            onSave={(v) => updateRdo.mutate({ notes: v })}
          />
        )}
        {step === 4 && <SignaturesStep rdoId={r.id} editable={editable} />}
        {step === 5 && (
          <FinalizeStep
            status={r.status}
            canReopen={canWrite}
            onFinalize={() => updateRdo.mutate({ status: "finalized", finalized_at: new Date().toISOString() })}
            onReopen={() => updateRdo.mutate({ status: "draft", finalized_at: null })}
          />
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="lg" className="flex-1" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="h-5 w-5" /> Voltar
        </Button>
        <Button size="lg" className="flex-1" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
          Próximo <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Efetivo ---------------- */

type TeamRow = {
  id: string;
  collaborator_id: string;
  present: boolean;
  entry_time: string | null;
  exit_time: string | null;
  break_minutes: number;
  worked_hours: number | null;
  reported_reason: string | null;
  reported_note: string | null;
  occurrence_status: string;
  final_classification: string | null;
  collaborators: { full_name: string; registration_number: string } | null;
  position_id: string | null;
  positions: { name: string } | null;
};

function AddWorker({ rdoId, night, work, date, existing }: { rdoId: string; night?: boolean; work: WorkRow; date: string; existing: string[] }) {
  const qc = useQueryClient();
  const { canWrite } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wd = new Date(date + "T12:00:00").getDay();
  const holiday = useQuery({
    queryKey: ["holiday", date],
    queryFn: async () => ((await supabase.from("holidays").select("id").eq("date", date)).data ?? []).length > 0,
  });
  const allowed = canWrite || wd === 0 || wd === 6 || !!holiday.data;
  const people = useQuery({
    queryKey: ["rdo-add-people"],
    enabled: open,
    queryFn: async () =>
      (await supabase.from("collaborators").select("id, full_name, position_id").eq("status", "active").order("full_name")).data ?? [],
  });
  const add = useMutation({
    mutationFn: async (p: { id: string; position_id: string | null }) => {
      const exit = (wd === 0 || wd === 5 || wd === 6) && work.exit_time_weekend ? work.exit_time_weekend : work.exit_time;
      const { error } = await supabase.rpc("rdo_add_worker" as never, {
        _rdo_id: rdoId,
        _collaborator_id: p.id,
        _position_id: p.position_id,
        _entry: night ? NIGHT_ENTRY : work.entry_time?.slice(0, 5) ?? "07:00",
        _exit: night ? NIGHT_EXIT : exit?.slice(0, 5) ?? "17:00",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador adicionado e lançado na Programação");
      qc.invalidateQueries({ queryKey: ["rdo-team", rdoId] });
      qc.invalidateQueries({ queryKey: ["rdo-planned", work.id, date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!allowed) return null;
  const list = (people.data ?? []).filter(
    (p) => !existing.includes(p.id) && p.full_name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Adicionar colaborador
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden">
          <DialogHeader><DialogTitle>Adicionar colaborador</DialogTitle></DialogHeader>
          <Input placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {people.isLoading && <li className="text-sm text-muted-foreground">Carregando...</li>}
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  className="w-full rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                  onClick={() => add.mutate({ id: p.id, position_id: p.position_id })}
                >
                  {p.full_name}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamStep({ rdoId, night, work, date, rows, editable }: { rdoId: string; night?: boolean; work: WorkRow; date: string; rows: TeamRow[]; editable: boolean }) {
  const qc = useQueryClient();
  const [absent, setAbsent] = useState<TeamRow | null>(null);

  const patch = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const { error } = await supabase.from("rdo_workforce").update(data as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rdo-team", rdoId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const positions = useQuery({
    queryKey: ["rdo-positions"],
    queryFn: async () => (await supabase.from("positions").select("id, name").eq("active", true).order("name")).data ?? [],
  });
  const posOptions = useMemo(() => {
    const seen = new Set<string>();
    return (positions.data ?? [])
      .map((p) => ({ id: p.id, label: positionLabel(p.name)! }))
      .filter((p) => (seen.has(p.label.toLowerCase()) ? false : (seen.add(p.label.toLowerCase()), true)))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [positions.data]);

  const present = rows.filter((r) => r.present);
  const total = present.reduce((s, r) => s + workedHours(r.entry_time?.slice(0, 5), r.exit_time?.slice(0, 5), r.break_minutes), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base uppercase">Efetivo</h2>
        <p className="text-xs text-muted-foreground">
          {present.length} presentes de {rows.length} previstos · {total.toFixed(2).replace(".", ",")} h · intervalo 1h
        </p>
      </div>
      {editable && <AddWorker rdoId={rdoId} night={!!night} work={work} date={date} existing={rows.map((r) => r.collaborator_id)} />}
      {rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Ninguém escalado nesta obra na Programação deste dia.</p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={cn("rounded-md border border-border p-3", !r.present && "bg-destructive/5")}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium leading-tight", !r.present && "line-through opacity-70")}>{r.collaborators?.full_name}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {editable ? (
                    <Select
                      value={posOptions.find((o) => o.label === positionLabel(r.positions?.name))?.id ?? r.position_id ?? ""}
                      onValueChange={(v) => patch.mutate({ id: r.id, data: { position_id: v } })}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs"><SelectValue placeholder="Sem função" /></SelectTrigger>
                      <SelectContent>
                        {posOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span>{positionLabel(r.positions?.name) ?? "Sem função"}</span>
                  )}
                  <span>Mat. {r.collaborators?.registration_number}</span>
                </div>
                {!r.present && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {reasonLabel(r.reported_reason, r.reported_note)}
                    {r.occurrence_status === "pending" && " · aguardando classificação"}
                    {r.occurrence_status === "classified" && ` · classificado: ${reasonLabel(r.final_classification)}`}
                  </p>
                )}
              </div>
              {editable && (
                r.present ? (
                  <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 border-destructive/40" aria-label="Não compareceu" onClick={() => setAbsent(r)}>
                    <X className="h-5 w-5 text-destructive" />
                  </Button>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Editar falta" onClick={() => setAbsent(r)}>
                      <Pencil className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11"
                      aria-label="Marcar como presente"
                      onClick={async () => {
                        if (!confirm(`Desfazer a falta de ${r.collaborators?.full_name ?? "colaborador"} e marcar como presente?`)) return;
                        const { error } = await supabase.rpc("rdo_undo_absence" as never, { _wf_id: r.id } as never);
                        if (error) { toast.error(error.message); return; }
                        toast.success("Marcado como presente");
                        qc.invalidateQueries({ queryKey: ["rdo-team"] });
                      }}
                    >
                      <Undo2 className="h-5 w-5" />
                    </Button>
                  </div>
                )
              )}
              {r.present && <Check className="mt-3 h-5 w-5 shrink-0 text-success" />}
            </div>
            {r.present && (
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <div className="min-w-0">
                  <Label className="text-[11px]">Entrada</Label>
                  <Input
                    type="time"
                    className="h-11 w-full min-w-0 max-w-full appearance-none px-2 text-base [&::-webkit-date-and-time-value]:text-left"
                    disabled={!editable}
                    defaultValue={r.entry_time?.slice(0, 5) ?? ""}
                    onBlur={(e) => e.target.value !== r.entry_time?.slice(0, 5) && patch.mutate({ id: r.id, data: { entry_time: e.target.value || null } })}
                  />
                </div>
                <div className="min-w-0">
                  <Label className="text-[11px]">Saída</Label>
                  <Input
                    type="time"
                    className="h-11 w-full min-w-0 max-w-full appearance-none px-2 text-base [&::-webkit-date-and-time-value]:text-left"
                    disabled={!editable}
                    defaultValue={r.exit_time?.slice(0, 5) ?? ""}
                    onBlur={(e) => e.target.value !== r.exit_time?.slice(0, 5) && patch.mutate({ id: r.id, data: { exit_time: e.target.value || null } })}
                  />
                </div>
                <div className="w-14">
                  <Label className="text-[11px]">Horas</Label>
                  <p className="flex h-11 items-center justify-end font-semibold">
                    {workedHours(r.entry_time?.slice(0, 5), r.exit_time?.slice(0, 5), r.break_minutes).toFixed(2).replace(".", ",")}
                  </p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <RdoAbsenceDialog
        open={!!absent}
        onOpenChange={(v) => !v && setAbsent(null)}
        mode="report"
        collaboratorName={absent?.collaborators?.full_name ?? ""}
        workName={workLabel(work)}
        date={date}
        reportedReason={absent?.reported_reason}
        reportedNote={absent?.reported_note}
        busy={patch.isPending}
        onConfirm={async (key, note) => {
          if (!absent) return;
          // Editando uma falta já registrada: desfaz antes de registrar o novo motivo.
          if (!absent.present) {
            const { error: undoErr } = await supabase.rpc("rdo_undo_absence" as never, { _wf_id: absent.id } as never);
            if (undoErr) { alert(undoErr.message); return; }
          }
          // Motivos diretos já vão para a caixa da Programação; "outro" fica pendente.
          const { error } = await supabase.rpc("rdo_report_absence" as never, {
            _wf_id: absent.id,
            _reason: key,
            _note: note || null,
          } as never);
          if (error) {
            alert(error.message);
            return;
          }
          qc.invalidateQueries({ queryKey: ["rdo-team"] });
          setAbsent(null);
        }}
      />
    </div>
  );
}

/* ---------------- Texto livre ---------------- */

function TextStep({ label, value, placeholder, editable, onSave }: { label: string; value: string; placeholder?: string; editable: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="space-y-2">
      <h2 className="font-display text-base uppercase">{label}</h2>
      <Textarea rows={8} value={v} placeholder={placeholder} disabled={!editable} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
      <p className="text-xs text-muted-foreground">Salvo automaticamente ao sair do campo.</p>
    </div>
  );
}

/* ---------------- Serviços + Andaimes ---------------- */

function ServicesStep({ rdoId, editable, onlyScaffolds = false }: { rdoId: string; editable: boolean; onlyScaffolds?: boolean }) {
  const qc = useQueryClient();
  const [svcDialog, setSvcDialog] = useState<string | null>(null);
  const [scafOpen, setScafOpen] = useState(false);
  const [scafEdit, setScafEdit] = useState<any>(null);

  const services = useQuery({
    queryKey: ["rdo-services", rdoId],
    queryFn: async () => (await supabase.from("rdo_services").select("*").eq("rdo_id", rdoId).order("created_at")).data ?? [],
  });
  const scaffolds = useQuery({
    queryKey: ["rdo-scaffolds", rdoId],
    queryFn: async () => (await supabase.from("rdo_scaffolds").select("*").eq("rdo_id", rdoId).order("created_at")).data ?? [],
  });
  const del = useMutation({
    mutationFn: async ({ table, id }: { table: "rdo_services" | "rdo_scaffolds"; id: string }) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rdo-services", rdoId] });
      qc.invalidateQueries({ queryKey: ["rdo-scaffolds", rdoId] });
    },
  });

  const block = (title: string, onAdd: () => void, addLabel: string, children: React.ReactNode) => (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-3 py-2">
        <h3 className="font-display text-sm uppercase">{title}</h3>
        {editable && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="h-4 w-4" /> {addLabel}
          </Button>
        )}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );

  const svcList = (cat: string) => {
    const list = (services.data ?? []).filter((s) => s.category === cat);
    if (!list.length) return <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum registro.</p>;
    return list.map((s) => (
      <div key={s.id} className="flex items-start gap-2 px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.description}</p>
          <p className="text-xs text-muted-foreground">
            {[s.location, s.quantity != null && `${s.quantity} ${s.unit ?? ""}`, s.productivity != null && `produt. ${s.productivity}`, s.team, s.notes]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {editable && (
          <Button variant="ghost" size="icon" onClick={() => del.mutate({ table: "rdo_services", id: s.id })} aria-label="Excluir">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    ));
  };

  return (
    <div className="space-y-3">
      {!onlyScaffolds && <h2 className="font-display text-base uppercase">Serviços / apontamentos</h2>}
      {!onlyScaffolds && block("Civil", () => setSvcDialog("civil"), "Adicionar", svcList("civil"))}
      {block(
        "Andaimes",
        () => setScafOpen(true),
        onlyScaffolds ? "Andaimes" : "Adicionar",
        (scaffolds.data ?? []).length ? (
          (scaffolds.data ?? []).map((s) => {
            const area = s.length_m && s.height_m ? Number(s.length_m) * Number(s.height_m) * Number(s.quantity) : null;
            const vol = area && s.width_m ? area * Number(s.width_m) : null;
            return (
              <div key={s.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {SCAFFOLD_OPS.find((o) => o.key === s.operation)?.label} · {s.scaffold_type || "Andaime"} ×{s.quantity}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[s.location, `${s.length_m ?? "-"} × ${s.width_m ?? "-"} × ${s.height_m ?? "-"} m`, area && `${area.toFixed(2)} m²`, vol && `${vol.toFixed(2)} m³`, s.notes]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {editable && (
                  <Button variant="ghost" size="icon" onClick={() => { setScafEdit(s); setScafOpen(true); }} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {editable && (
                  <Button variant="ghost" size="icon" onClick={() => del.mutate({ table: "rdo_scaffolds", id: s.id })} aria-label="Excluir">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            );
          })
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum andaime.</p>
        ),
      )}
      {!onlyScaffolds && SERVICE_CATEGORIES.filter((c) => c.key !== "civil").map((c) => (
        <div key={c.key}>{block(c.label, () => setSvcDialog(c.key), "Adicionar", svcList(c.key))}</div>
      ))}
      <ServiceDialog rdoId={rdoId} category={svcDialog} onClose={() => setSvcDialog(null)} />
      <ScaffoldDialog rdoId={rdoId} open={scafOpen} edit={scafEdit} onClose={() => { setScafOpen(false); setScafEdit(null); }} />
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function ServiceDialog({ rdoId, category, onClose }: { rdoId: string; category: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { description: "", location: "", quantity: "", unit: "", productivity: "", team: "", notes: "" };
  const [f, setF] = useState(empty);
  useEffect(() => setF(empty), [category]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rdo_services").insert({
        rdo_id: rdoId,
        category: category!,
        description: f.description.trim(),
        location: f.location || null,
        quantity: num(f.quantity),
        unit: f.unit || null,
        productivity: num(f.productivity),
        team: f.team || null,
        notes: f.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rdo-services", rdoId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!category} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{SERVICE_CATEGORIES.find((c) => c.key === category)?.label}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Label>Atividade *</Label><Input className="h-11" value={f.description} onChange={set("description")} /></div>
          <div className="col-span-2"><Label>Local</Label><Input className="h-11" value={f.location} onChange={set("location")} /></div>
          <div><Label>Quantidade</Label><Input className="h-11" inputMode="decimal" value={f.quantity} onChange={set("quantity")} /></div>
          <div><Label>Unidade</Label><Input className="h-11" placeholder="m², m, un" value={f.unit} onChange={set("unit")} /></div>
          <div><Label>Produtividade</Label><Input className="h-11" inputMode="decimal" value={f.productivity} onChange={set("productivity")} /></div>
          {category === "alpinismo" && <div><Label>Equipe envolvida</Label><Input className="h-11" value={f.team} onChange={set("team")} /></div>}
          <div className="col-span-2"><Label>Observações</Label><Textarea value={f.notes} onChange={set("notes")} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!f.description.trim() || save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScaffoldDialog({ rdoId, open, edit, onClose }: { rdoId: string; open: boolean; edit?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { scaffold_type: "", location: "", length_m: "", width_m: "", height_m: "", quantity: "1", operation: "montagem", notes: "" };
  const [f, setF] = useState(empty);
  const str = (v: any) => (v == null ? "" : String(v));
  useEffect(() => {
    if (!open) return;
    setF(edit ? { scaffold_type: str(edit.scaffold_type), location: str(edit.location), length_m: str(edit.length_m), width_m: str(edit.width_m), height_m: str(edit.height_m), quantity: str(edit.quantity ?? 1), operation: edit.operation ?? "montagem", notes: str(edit.notes) } : empty);
  }, [open, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        scaffold_type: f.scaffold_type || null,
        location: f.location || null,
        length_m: num(f.length_m),
        width_m: num(f.width_m),
        height_m: num(f.height_m),
        quantity: num(f.quantity) ?? 1,
        operation: f.operation,
        notes: f.notes || null,
      };
      const { error } = edit
        ? await supabase.from("rdo_scaffolds").update(row).eq("id", edit.id)
        : await supabase.from("rdo_scaffolds").insert({ rdo_id: rdoId, ...row });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rdo-scaffolds", rdoId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const l = num(f.length_m), w = num(f.width_m), h = num(f.height_m), q = num(f.quantity) ?? 1;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{edit ? "Editar andaime" : "Adicionar andaime"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3">
            <Label>Operação</Label>
            <div className="grid grid-cols-3 gap-1">
              {SCAFFOLD_OPS.map((o) => (
                <button key={o.key} type="button" onClick={() => setF({ ...f, operation: o.key })}
                  className={cn("min-h-11 rounded-md border text-xs font-medium", f.operation === o.key ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2"><Label>Tipo</Label><Input className="h-11" placeholder="Tubular, multidirecional..." value={f.scaffold_type} onChange={set("scaffold_type")} /></div>
          <div><Label>Qtd.</Label><Input className="h-11" inputMode="decimal" value={f.quantity} onChange={set("quantity")} /></div>
          <div className="col-span-3"><Label>Local</Label><Input className="h-11" value={f.location} onChange={set("location")} /></div>
          <div><Label>Compr. (m)</Label><Input className="h-11" inputMode="decimal" value={f.length_m} onChange={set("length_m")} /></div>
          <div><Label>Largura (m)</Label><Input className="h-11" inputMode="decimal" value={f.width_m} onChange={set("width_m")} /></div>
          <div><Label>Altura (m)</Label><Input className="h-11" inputMode="decimal" value={f.height_m} onChange={set("height_m")} /></div>
          <p className="col-span-3 text-xs text-muted-foreground">
            {l && h ? `Área: ${(l * h * q).toFixed(2)} m²` : "Área: —"}
            {l && h && w ? ` · Volume: ${(l * h * w * q).toFixed(2)} m³` : ""}
          </p>
          <div className="col-span-3"><Label>Observações</Label><Textarea value={f.notes} onChange={set("notes")} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Fotos e vídeos ---------------- */

function MediaStep({ rdoId, editable }: { rdoId: string; editable: boolean }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [reversed, setReversedState] = useState(false);
  useEffect(() => setReversedState(getMediaReversed(rdoId)), [rdoId]);
  const setReversed = (f: (r: boolean) => boolean) => setReversedState((r) => { const v = f(r); setMediaReversed(rdoId, v); return v; });
  const [rotating, setRotating] = useState<string | null>(null);
  const media = useQuery({
    queryKey: ["rdo-media", rdoId],
    queryFn: async () => {
      const { data } = await supabase.from("rdo_media").select("*").eq("rdo_id", rdoId).order("created_at");
      const list = data ?? [];
      const urls = list.length
        ? (await supabase.storage.from("rdo-media").createSignedUrls(list.map((m) => m.storage_path), 3600)).data ?? []
        : [];
      return list.map((m, i) => ({ ...m, url: urls[i]?.signedUrl ?? "" }));
    },
  });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("video") ? "video" : "photo";
        const ext = file.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg");
        const body = kind === "photo" ? await normalizePhoto(file) : file;
        const isJpeg = kind === "photo" && body !== file;
        const path = `${rdoId}/${crypto.randomUUID()}.${isJpeg ? "jpg" : ext}`;
        const { error } = await supabase.storage.from("rdo-media").upload(path, body, { contentType: isJpeg ? "image/jpeg" : file.type });
        if (error) throw error;
        const { error: e2 } = await supabase.from("rdo_media").insert({ rdo_id: rdoId, kind, storage_path: path });
        if (e2) throw e2;
      }
      toast.success("Arquivo(s) enviado(s)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      qc.invalidateQueries({ queryKey: ["rdo-media", rdoId] });
    }
  }

  const remove = useMutation({
    mutationFn: async (m: { id: string; storage_path: string }) => {
      await supabase.storage.from("rdo-media").remove([m.storage_path]);
      const { error } = await supabase.from("rdo_media").delete().eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rdo-media", rdoId] }),
  });
  async function rotate(m: { id: string; storage_path: string; url: string }) {
    setRotating(m.id);
    try {
      const blob = await rotatePhoto(m.url);
      const path = `${rdoId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("rdo-media").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const { error: e2 } = await supabase.from("rdo_media").update({ storage_path: path }).eq("id", m.id);
      if (e2) throw e2;
      await supabase.storage.from("rdo-media").remove([m.storage_path]);
      qc.invalidateQueries({ queryKey: ["rdo-media", rdoId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRotating(null);
    }
  }
  const describe = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase.from("rdo_media").update({ description: description || null }).eq("id", id);
      if (error) throw error;
    },
  });

  const picker = (label: string, icon: React.ReactNode, accept: string, capture?: "environment") => (
    <label className={cn("flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs font-medium hover:bg-muted", (!editable || uploading) && "pointer-events-none opacity-50")}>
      {icon}
      {label}
      <input type="file" className="hidden" accept={accept} multiple={!capture} capture={capture} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base uppercase">Fotos e vídeos</h2>
        <Button type="button" size="icon" variant="outline" aria-label="Inverter ordem" title="Inverter ordem" onClick={() => setReversed((r) => !r)}>
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>
      {editable && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {picker("Tirar foto", <Camera className="h-5 w-5" />, "image/*", "environment")}
          {picker("Gravar vídeo", <Video className="h-5 w-5" />, "video/*", "environment")}
          {picker("Importar fotos", <ImagePlus className="h-5 w-5" />, "image/*")}
          {picker("Importar vídeos", <Video className="h-5 w-5" />, "video/*")}
        </div>
      )}
      {uploading && <p className="text-xs text-muted-foreground">Enviando...</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(reversed ? [...(media.data ?? [])].reverse() : media.data ?? []).map((m) => (
          <div key={m.id} className="space-y-1 rounded-md border border-border p-2">
            {m.kind === "video" ? (
              <video src={m.url} controls className="aspect-video w-full rounded bg-black" />
            ) : (
              <img src={m.url} alt={m.description ?? "Foto do RDO"} className="aspect-video w-full rounded object-cover" />
            )}
            <div className="flex gap-1">
              <Input
                placeholder="Descrição (opcional)"
                defaultValue={m.description ?? ""}
                disabled={!editable}
                onBlur={(e) => e.target.value !== (m.description ?? "") && describe.mutate({ id: m.id, description: e.target.value })}
              />
              {editable && m.kind === "photo" && (
                <Button variant="ghost" size="icon" disabled={rotating === m.id} onClick={() => void rotate(m)} aria-label="Girar foto" title="Girar foto">
                  <RotateCw className={cn("h-4 w-4", rotating === m.id && "animate-spin")} />
                </Button>
              )}
              {editable && (
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(m)} aria-label="Excluir">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!media.data?.length && <p className="text-center text-xs text-muted-foreground">Nenhuma mídia anexada.</p>}
    </div>
  );
}

/* ---------------- Assinaturas ---------------- */

function SignaturesStep({ rdoId, editable }: { rdoId: string; editable: boolean }) {
  const { isCliente } = useCurrentUser();
  const sigs = useQuery({
    queryKey: ["rdo-sigs", rdoId],
    queryFn: async () => (await supabase.from("rdo_signatures").select("*").eq("rdo_id", rdoId)).data ?? [],
  });
  return (
    <div className="space-y-4">
      <h2 className="font-display text-base uppercase">Assinaturas</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <SignatureBox rdoId={rdoId} kind="ab5" title="Responsável AB5" existing={sigs.data?.find((s) => s.kind === "ab5")} editable={editable} />
        <SignatureBox rdoId={rdoId} kind="client" title="Responsável cliente" existing={sigs.data?.find((s) => s.kind === "client")} editable={editable || isCliente} />
      </div>
    </div>
  );
}

function SignatureBox({ rdoId, kind, title, existing, editable }: { rdoId: string; kind: string; title: string; existing?: { id: string; signer_name: string; signature_data: string; signed_at: string } | undefined; editable: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [data, setData] = useState<string | null>(null);
  const isAb5 = kind === "ab5";
  const saved = useQuery({
    queryKey: ["my-saved-signature"],
    enabled: isAb5,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      return (await supabase.from("user_saved_signatures").select("signer_name, signature_data").eq("user_id", u.user.id).maybeSingle()).data;
    },
  });
  const keep = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("user_saved_signatures").upsert(
        { user_id: u.user!.id, signer_name: existing!.signer_name, signature_data: existing!.signature_data },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Assinatura guardada para as próximas vezes"); qc.invalidateQueries({ queryKey: ["my-saved-signature"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const useSaved = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rdo_signatures").upsert(
        { rdo_id: rdoId, kind, signer_name: saved.data!.signer_name, signature_data: saved.data!.signature_data, signed_at: new Date().toISOString() },
        { onConflict: "rdo_id,kind" },
      );
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Assinatura aplicada"); qc.invalidateQueries({ queryKey: ["rdo-sigs", rdoId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rdo_signatures").upsert(
        { rdo_id: rdoId, kind, signer_name: name.trim(), signature_data: data!, signed_at: new Date().toISOString() },
        { onConflict: "rdo_id,kind" },
      );
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Assinatura salva"); qc.invalidateQueries({ queryKey: ["rdo-sigs", rdoId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => { await supabase.from("rdo_signatures").delete().eq("id", existing!.id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rdo-sigs", rdoId] }),
  });
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-display text-sm uppercase">{title}</h3>
      {existing ? (
        <>
          <img src={existing.signature_data} alt={`Assinatura de ${existing.signer_name}`} className="h-32 w-full rounded bg-white object-contain" />
          <p className="text-sm font-medium">{existing.signer_name}</p>
          <p className="text-xs text-muted-foreground">{new Date(existing.signed_at).toLocaleString("pt-BR")}</p>
          <div className="flex flex-wrap gap-2">
            {editable && <Button variant="outline" size="sm" onClick={() => remove.mutate()}>Refazer assinatura</Button>}
            {isAb5 && saved.data?.signature_data !== existing.signature_data && (
              <Button variant="outline" size="sm" disabled={keep.isPending} onClick={() => keep.mutate()}>Salvar assinatura para próximas vezes</Button>
            )}
          </div>
        </>
      ) : editable ? (
        <>
          {isAb5 && saved.data && (
            <Button variant="secondary" className="w-full" disabled={useSaved.isPending} onClick={() => useSaved.mutate()}>
              Usar minha assinatura salva ({saved.data.signer_name})
            </Button>
          )}
          <Input className="h-11" placeholder="Nome do responsável" value={name} onChange={(e) => setName(e.target.value)} />
          <SignaturePad onChange={setData} />
          <Button className="w-full" size="lg" disabled={!name.trim() || !data || save.isPending} onClick={() => save.mutate()}>Salvar assinatura</Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Não assinado.</p>
      )}
    </div>
  );
}

/* ---------------- Finalizar ---------------- */

function FinalizeStep({ status, canReopen, onFinalize, onReopen }: { status: string; canReopen: boolean; onFinalize: () => void; onReopen: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3 text-center">
      <h2 className="font-display text-base uppercase">Finalizar RDO</h2>
      {status === "draft" ? (
        <Button size="lg" className="w-full" onClick={() => setConfirm(true)}>
          <Check className="h-5 w-5" /> Finalizar RDO
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Este RDO está finalizado.</p>
          {canReopen && <Button variant="outline" onClick={onReopen}>Reabrir como rascunho</Button>}
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar RDO</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja finalizar este RDO? Após a finalização, algumas informações poderão ficar bloqueadas para edição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onFinalize}>Finalizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

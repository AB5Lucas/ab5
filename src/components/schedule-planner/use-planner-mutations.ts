import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { checkRequirements, type ScheduleContext } from "@/lib/scheduling";
import { classifyOccurrence, type PendingOccurrence } from "@/lib/rdo";
import { invalidateScheduleDay } from "@/lib/invalidate-day";
import { boxLabelOf, type DragPayload, type Evaluation } from "@/components/schedule-planner/boxes";
import type { PlannerEntry, PlannerGroup, PlannerRow } from "@/components/schedule-planner/planner-api";
import type { Collaborator } from "@/lib/scheduling";

/**
 * Gravações da Programação: arrastar para obra/quadro, tirar da obra ou do quadro (folga de vários dias pergunta
 * só o dia ou inteira), classificar ocorrência do RDO. Erros passam por onWriteError (duplicidade = releitura do dia).
 */
export function usePlannerMutations(d: {
  date: string;
  c: ScheduleContext | undefined;
  rows: PlannerRow[];
  entries: PlannerEntry[];
  personById: Map<string, Collaborator>;
  allocByCollaborator: Map<string, PlannerRow>;
  allocById: Map<string, PlannerRow>;
  entryById: Map<string, PlannerEntry>;
  entryByCollaborator: Map<string, PlannerEntry>;
  evaluate: (collaboratorId: string, workId: string | null, opts?: { ignoreEntry?: boolean }) => Evaluation;
  ensureSchedule: () => Promise<string>;
  invalidate: (id?: string | null) => void;
  onWriteError: (e: unknown) => void;
  setOccOpen: (o: PendingOccurrence | null) => void;
  setClearBox: (v: { label: string; ids: string[] } | null) => void;
}) {
  const qc = useQueryClient();
  const { date, c, rows, entries, personById, allocByCollaborator, allocById, entryById, entryByCollaborator, evaluate,
    ensureSchedule, invalidate, onWriteError, setOccOpen, setClearBox } = d;
  const classify = useMutation({
    mutationFn: async ({ occ, key }: { occ: PendingOccurrence; key: string }) => {
      const { data: u } = await supabase.auth.getUser();
      await classifyOccurrence(occ, key, u.user?.id ?? null);
      return occ;
    },
    onSuccess: () => {
      toast.success("Ocorrência classificada e programação atualizada");
      setOccOpen(null);
      qc.invalidateQueries({ queryKey: ["rdo-pending", date] });
      qc.invalidateQueries({ queryKey: ["schedule", date] });
      qc.invalidateQueries({ queryKey: ["allocations"] });
      qc.invalidateQueries({ queryKey: ["status-entries"] });
    },
    onError: onWriteError,
  });
  const keepOcc = useMutation({
    mutationFn: async (occ: PendingOccurrence) => {
      const { error } = await supabase
        .from("rdo_workforce")
        .update({ present: true, occurrence_status: "none", reported_reason: null, reported_note: null, final_classification: null })
        .eq("id", occ.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Colaborador mantido no efetivo");
      setOccOpen(null);
      qc.invalidateQueries({ queryKey: ["rdo-pending", date] });
    },
    onError: onWriteError,
  });

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
      if (boxKey === "folga") {
        // Cadastra automaticamente a folga do dia na aba Folgas
        const { data: existing } = await supabase
          .from("days_off")
          .select("id")
          .eq("collaborator_id", collaboratorId)
          .lte("date", date)
          .or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`)
          .limit(1);
        if (!existing?.length) {
          const { error: e2 } = await supabase
            .from("days_off")
            .insert({ collaborator_id: collaboratorId, date, reason: "Programação" });
          if (e2) throw e2;
        }
      }
      return { id, name, boxKey };
    },
    onSuccess: (r) => {
      toast.success(`${r.name} registrado em ${boxLabelOf(r.boxKey)}`);
      invalidate(r.id);
      if (r.boxKey === "folga") {
        qc.invalidateQueries({ queryKey: ["schedule-ctx", date] });
        qc.invalidateQueries({ queryKey: ["days_off"] });
      }
    },
    onError: onWriteError,
  });

  const removeEntry = useMutation({
    mutationFn: async ({ id, folga }: { id: string; folga?: "day" | "all" }) => {
      const entry = entryById.get(id);
      const { error } = await supabase.from("daily_status_entries").delete().eq("id", id);
      if (error) throw error;
      if (entry?.box_key === "folga") {
        // Só o dia: encurta ou divide o período da folga; inteira: apaga o registro (day_off_remove_day, uma transação).
        const { error: offErr } = await supabase.rpc("day_off_remove_day", { _collaborator_id: entry.collaborator_id, _date: date, _whole: folga === "all" });
        if (offErr) throw offErr;
      }
    },
    onSuccess: () => {
      toast.success("Registro removido da caixa");
      setFolgaAsk(null);
      invalidate();
      invalidateScheduleDay(qc);
    },
    onError: onWriteError,
  });
  /** Folga de vários dias: pergunta se tira só o dia aberto ou a folga inteira. */
  const [folgaAsk, setFolgaAsk] = useState<{ id: string; name: string; start: string; end: string } | null>(null);
  async function askRemoveEntry(id: string) {
    const entry = entryById.get(id);
    if (entry?.box_key !== "folga") { removeEntry.mutate({ id }); return; }
    const { data, error } = await supabase.from("days_off").select("date, end_date")
      .eq("collaborator_id", entry.collaborator_id).lte("date", date)
      .or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`);
    if (error) { onWriteError(error); return; }
    const long = (data ?? []).find((o) => (o.end_date ?? o.date) !== o.date);
    if (!long) { removeEntry.mutate({ id, folga: "day" }); return; }
    setFolgaAsk({ id, name: personById.get(entry.collaborator_id)?.full_name ?? "Colaborador", start: long.date, end: long.end_date ?? long.date });
  }

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
      const targetRows = rows.filter((r) => r.work_id === workId && r.collaborator_id !== collaboratorId);
      // Solto em cima de alguém: entra no lugar dele e quem está dali para baixo desce uma posição (sort_order é inteiro).
      let sort: number;
      if (beforeSort != null) {
        sort = Math.ceil(beforeSort);
        const below = targetRows.filter((r) => r.sort_order >= sort);
        if (below.length) {
          // Uma transação só: falha no meio não deixa a ordem pela metade.
          const { error } = await supabase.rpc("reorder_allocations", { _ids: below.map((r) => r.id), _orders: below.map((r) => r.sort_order + 1) });
          if (error) throw error;
        }
      } else sort = targetRows.length ? Math.max(...targetRows.map((r) => r.sort_order)) + 1 : 0;

      // Ao mudar de obra, VT e prêmio viagem voltam à regra da obra nova (as exceções marcadas na obra antiga saem).
      const resetIfMoved = (fromWork: string | null | undefined) =>
        fromWork && fromWork !== workId ? { vt_override: null, travel_bonus_override: null } : {};
      if (fromBox) {
        // Sai do quadro e entra na obra na mesma transação (antes: apagava o quadro e depois inseria).
        const { error } = await supabase.rpc("schedule_entry_to_work", { _entry_id: fromBox.id, _work_id: workId, _sort: sort, _pending: issues.length > 0 });
        if (error) throw error;
      } else if (allocationId) {
        const { error } = await supabase
          .from("daily_allocations")
          .update({
            work_id: workId,
            sort_order: sort,
            has_pending_requirement: issues.length > 0,
            ...resetIfMoved(allocById.get(allocationId)?.work_id),
          })
          .eq("id", allocationId);
        if (error) throw error;
      } else {
        const existing = allocByCollaborator.get(collaboratorId);
        if (existing) {
          const { error } = await supabase
            .from("daily_allocations")
            .update({ work_id: workId, sort_order: sort, has_pending_requirement: issues.length > 0, ...resetIfMoved(existing.work_id) })
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
    onError: onWriteError,
  });

  /** Escolhe o serviço do cliente: mantém o atual, senão o último usado pela pessoa nesse cliente, senão o primeiro ativo. */
  async function dropOnGroup(p: DragPayload, g: PlannerGroup) {
    const ids = g.works.map((x) => x.id);
    const cur = p.allocationId ? allocById.get(p.allocationId) : allocByCollaborator.get(p.collaboratorId);
    let workId = cur && ids.includes(cur.work_id) ? cur.work_id : null;
    if (!workId && ids.length > 1) {
      const { data } = await supabase
        .from("daily_allocations")
        .select("work_id")
        .eq("collaborator_id", p.collaboratorId)
        .in("work_id", g.works.filter((x) => x.active).map((x) => x.id))
        .order("created_at", { ascending: false })
        .limit(1);
      workId = data?.[0]?.work_id ?? null;
    }
    drop.mutate({ ...p, workId: workId ?? g.rep.id });
  }

  const clearRows = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("daily_allocations").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => { toast.success(`${n} colaborador(es) retirados da escalação`); setClearBox(null); invalidate(); },
    onError: onWriteError,
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
    onError: onWriteError,
  });



  return { classify, keepOcc, dropBox, removeEntry, folgaAsk, setFolgaAsk, askRemoveEntry, drop, dropOnGroup, clearRows, removeRow };
}

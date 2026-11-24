import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { copyBoxes, selectedCopyRows } from "@/lib/schedule-copy";
import { addDays, formatDateBR } from "@/lib/scheduling";
import { fetchAll } from "@/lib/fetch-all";

type CopyResult = { count: number; notCopied: { name: string; reason: string }[]; splitNote: string | null };

/**
 * "Copiar dia" da Programação: escolhe o dia de origem e os quadros (clientes), copia quem pode ser escalado no dia
 * e, por padrão, a distribuição nos serviços (copy_service_split). Depois mostra quem não foi copiado e por quê.
 */
export function CopyDayDialog({
  date,
  open,
  onOpenChange,
  currentCount,
  workVt,
  skipReason,
  hasPending,
  nameOf,
  ensureSchedule,
  onCopied,
  onWriteError,
}: {
  date: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Linhas já escaladas no dia de destino (a ordem dos copiados começa depois delas). */
  currentCount: number;
  workVt: Map<string, boolean> | undefined;
  /** Motivo de não copiar a pessoa (ausência, agendamento, quadro, aviso prévio, ASO/treinamento); null = copia. */
  skipReason: (row: { work_id: string; collaborator_id: string }) => string | null;
  /** Requisitos não bloqueantes (marca has_pending_requirement). */
  hasPending: (row: { work_id: string; collaborator_id: string }) => boolean;
  nameOf: (collaboratorId: string) => string;
  ensureSchedule: () => Promise<string>;
  onCopied: (scheduleId: string) => void;
  onWriteError: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const [copyFrom, setCopyFrom] = useState(addDays(date, -1));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copySplit, setCopySplit] = useState(true);
  const [result, setResult] = useState<CopyResult | null>(null);
  useEffect(() => {
    if (open) { setCopyFrom(addDays(date, -1)); setCopySplit(true); }
  }, [open, date]);

  const copySource = useQuery({
    queryKey: ["schedule-copy-source", copyFrom],
    enabled: open && !!copyFrom,
    queryFn: async () => {
      const { data: source, error } = await supabase.from("daily_schedules").select("id").eq("schedule_date", copyFrom).maybeSingle();
      if (error) throw error;
      const rows = source
        ? await fetchAll<any>((a, b) => supabase.from("daily_allocations")
          .select("*, works(id, name, client_id, clients(name))").eq("schedule_id", source.id).order("id").range(a, b))
        : [];
      return { scheduleId: source?.id as string | undefined, rows };
    },
  });
  const sourceBoxes = useMemo(() => copyBoxes(copySource.data?.rows ?? []), [copySource.data]);
  useEffect(() => {
    setSelected(new Set(sourceBoxes.map((b) => b.key)));
  }, [sourceBoxes, open]);

  const copy = useMutation({
    mutationFn: async (): Promise<CopyResult & { id: string }> => {
      const prevSchedule = copySource.data?.scheduleId;
      if (!prevSchedule) throw new Error("Não existe programação na data selecionada");
      if (copyFrom === date) throw new Error("Escolha uma data diferente do destino");
      const prevRows = selectedCopyRows(copySource.data?.rows ?? [], selected);
      if (!prevRows.length) throw new Error("Selecione ao menos um quadro com efetivo");
      const selectedWorkIds = new Set(prevRows.map((r) => r.work_id));

      const id = await ensureSchedule();
      const { data: currentRows, error: currentError } = await supabase.from("daily_allocations").select("collaborator_id").eq("schedule_id", id);
      if (currentError) throw currentError;
      const existing = new Set((currentRows ?? []).map((r) => r.collaborator_id));
      const notCopied: { name: string; reason: string }[] = [];
      const candidates = prevRows.filter((r) => {
        if (existing.has(r.collaborator_id)) return false; // já escalado no dia: fica como está
        const why = skipReason(r);
        if (why) notCopied.push({ name: nameOf(r.collaborator_id), reason: why });
        return !why;
      });
      if (candidates.length === 0 && !notCopied.length) throw new Error("Nada novo para copiar dos quadros selecionados");
      const inserts = candidates.map((r, i) => ({
        schedule_id: id,
        work_id: r.work_id,
        collaborator_id: r.collaborator_id,
        position_id: r.position_id,
        vehicle_id: r.vehicle_id,
        driver: r.driver,
        vt_override: r.vt_override,
        travel_bonus_override: r.travel_bonus_override,
        source: "copied_previous_day" as const,
        confirmation_status: "pending" as const,
        has_pending_requirement: hasPending(r),
        sort_order: currentCount + i,
      }));
      let inserted: { collaborator_id: string }[] = [];
      if (inserts.length) {
        // Quem foi escalado por outro usuário no meio da cópia é pulado (chave única pessoa × dia), sem derrubar o lote.
        const { data, error } = await supabase.from("daily_allocations")
          .upsert(inserts, { onConflict: "schedule_id,collaborator_id", ignoreDuplicates: true })
          .select("collaborator_id");
        if (error) throw error;
        inserted = data ?? [];
        const got = new Set(inserted.map((x) => x.collaborator_id));
        for (const r of inserts) if (!got.has(r.collaborator_id)) notCopied.push({ name: nameOf(r.collaborator_id), reason: "escalado por outro usuário ou num quadro do dia" });
      }
      const { error: copiedErr } = await supabase.from("daily_schedules").update({ copied_from_schedule_id: prevSchedule }).eq("id", id);
      if (copiedErr) throw copiedErr;
      const { data: prevVt, error: prevVtErr } = await supabase.from("schedule_work_vt").select("work_id, pays_vt").eq("schedule_id", prevSchedule);
      if (prevVtErr) throw prevVtErr;
      const current = workVt ?? new Map<string, boolean>();
      const vtRows = (prevVt ?? []).filter((v) => selectedWorkIds.has(v.work_id) && !current.has(v.work_id)).map((v) => ({ schedule_id: id, work_id: v.work_id, pays_vt: v.pays_vt }));
      if (vtRows.length) {
        const { error } = await supabase.from("schedule_work_vt").upsert(vtRows, { onConflict: "schedule_id,work_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      const { data: prevTr, error: prevTrErr } = await supabase.from("schedule_work_travel").select("work_id, pays_bonus").eq("schedule_id", prevSchedule);
      if (prevTrErr) throw prevTrErr;
      const trRows = (prevTr ?? []).filter((v) => selectedWorkIds.has(v.work_id)).map((v) => ({ schedule_id: id, work_id: v.work_id, pays_bonus: v.pays_bonus }));
      if (trRows.length) {
        const { error } = await supabase.from("schedule_work_travel").upsert(trRows, { onConflict: "schedule_id,work_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      const clientIds = [...new Set(prevRows.map((r) => r.works?.client_id).filter((x): x is string => !!x))];
      if (clientIds.length) {
        const { error } = await supabase.from("schedule_client_visibility").upsert(
          clientIds.map((client_id) => ({ schedule_date: date, client_id, visible: true })),
          { onConflict: "schedule_date,client_id" },
        );
        if (error) throw error;
      }
      // Distribuição nos serviços: a mesma da aba Serviços ("Copiar do dia anterior"), cliente a cliente.
      let splitNote: string | null = null;
      if (copySplit && inserted.length) {
        const fails: string[] = [];
        let moved = 0;
        for (const cid of clientIds) {
          const { data, error } = await supabase.rpc("copy_service_split", { _client_id: cid, _date: date });
          if (error) fails.push(prevRows.find((r) => r.works?.client_id === cid)?.works?.clients?.name ?? "cliente");
          else moved += Number(data ?? 0);
        }
        splitNote = fails.length
          ? `Distribuição não copiada em: ${fails.join(", ")} (sem acesso à aba Serviços desses clientes)`
          : moved ? `${moved} pessoa(s) distribuída(s) nos serviços como no dia útil anterior` : null;
      }
      return { id, count: inserted.length, notCopied: notCopied.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), splitNote };
    },
    onSuccess: (r) => {
      toast.success(`${r.count} alocação(ões) copiadas de ${formatDateBR(copyFrom)}`);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["work-vt", r.id] });
      qc.invalidateQueries({ queryKey: ["work-travel", r.id] });
      qc.invalidateQueries({ queryKey: ["client-visibility", date] });
      onCopied(r.id);
      if (r.notCopied.length || r.splitNote) setResult(r);
    },
    onError: onWriteError,
  });

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copiar programação</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmar cópia dos quadros selecionados para {formatDateBR(date)}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm" htmlFor="copy-source-date">
              <span className="font-medium">Dia que será copiado</span>
              <Input id="copy-source-date" type="date" value={copyFrom} disabled={copy.isPending} onChange={(e) => { setCopyFrom(e.target.value); setSelected(new Set()); }} />
            </label>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Obras com efetivo</p>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={copy.isPending || !sourceBoxes.length}
                    onClick={() => setSelected(new Set(sourceBoxes.map((b) => b.key)))}>Todos</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={copy.isPending || !selected.size}
                    onClick={() => setSelected(new Set())}>Nenhum</Button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {copySource.isFetching ? <p className="p-3 text-sm text-muted-foreground">Carregando obras...</p> : copySource.error ? <p className="p-3 text-sm text-destructive">Não foi possível carregar a programação.</p> : sourceBoxes.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nenhuma obra com efetivo nesta data.</p> : sourceBoxes.map((box) => (
                  <label key={box.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Checkbox checked={selected.has(box.key)} disabled={copy.isPending} onCheckedChange={(checked) => setSelected((old) => {
                      const next = new Set(old);
                      if (checked) next.add(box.key); else next.delete(box.key);
                      return next;
                    })} />
                    <span className="min-w-0 flex-1 break-words">{box.label}</span>
                    <span className="text-xs text-muted-foreground">{box.count}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={copySplit} disabled={copy.isPending} onCheckedChange={(v) => setCopySplit(!!v)} />
              Copiar também a distribuição nos serviços
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={copy.isPending || copySource.isFetching || !!copySource.error || !copyFrom || copyFrom === date || !selected.size} onClick={() => copy.mutate()}>
              {copy.isPending ? "Copiando..." : "Copiar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!result} onOpenChange={(v) => !v && setResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cópia concluída: {result?.count ?? 0} alocação(ões)</AlertDialogTitle>
            {result?.splitNote && <AlertDialogDescription>{result.splitNote}</AlertDialogDescription>}
          </AlertDialogHeader>
          {!!result?.notCopied.length && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Não copiados ({result.notCopied.length})</p>
              <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border p-2 text-xs">
                {result.notCopied.map((n, i) => <li key={i}>{n.name} · {n.reason}</li>)}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

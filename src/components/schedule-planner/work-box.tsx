import { memo, type MutableRefObject } from "react";
import { AlertTriangle, ArrowDown, Ban, Copy, GripVertical, MapPin, Moon, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { addDays, checkIntegration, formatBR } from "@/lib/scheduling";
import { LODGING_LABEL, LODGING_TAG } from "@/lib/lodging";
import type { PlannerApi, PlannerGroup, PlannerRow } from "@/components/schedule-planner/planner-api";

/**
 * Quadro de um cliente na Programação. Memorizado: só volta a desenhar quando muda o efetivo do quadro, a seleção,
 * o arrastar sobre ele ou os dados do dia (`version`). As ações e leituras vêm de `apiRef` (sempre a versão atual).
 */
export const WorkBox = memo(function WorkBox({
  g,
  workRows,
  selected,
  isHover,
  blockedTarget,
  editable,
  apiRef,
}: {
  g: PlannerGroup;
  workRows: PlannerRow[];
  selected: boolean;
  isHover: boolean;
  blockedTarget: boolean;
  editable: boolean;
  /** Muda quando os dados do dia mudam (alocações, benefícios, ocorrências...): força o redesenho. */
  version: string;
  apiRef: MutableRefObject<PlannerApi>;
}) {
  const api = apiRef.current;
  const w = g.rep;
  const ids = new Set(g.works.map((x) => x.id));
  return (
    <section
      onClick={() => api.setSelectedWork((s) => (s === w.id ? null : w.id))}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        api.setHoverWork(w.id);
      }}
      onDragLeave={() => api.setHoverWork((h) => (h === w.id ? null : h))}
      onDrop={(e) => {
        e.preventDefault();
        api.setHoverWork(null);
        const p = api.readPayload(e);
        api.setDragging(null);
        if (!p || !editable) return;
        void api.dropOnGroup(p, g);
      }}
      className={cn(
        "panel flex h-72 cursor-pointer flex-col overflow-hidden transition",
        selected && "ring-2 ring-primary",
        isHover && !blockedTarget && "ring-2 ring-emerald-500",
        isHover && blockedTarget && "ring-2 ring-destructive",
      )}
    >
      <header className="border-b border-border bg-secondary/60 px-2 py-1.5">
        <div className="flex items-start gap-1.5">
          <h2 className="font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide">
            {g.label}
          </h2>
          {(() => {
            // Só conta quem ainda está no quadro: tirou a pessoa do cliente, o "!" sai.
            const occ = (api.pendingOcc ?? []).filter((o) => ids.has(o.work_id) && api.rows.some((r) => r.collaborator_id === o.collaborator_id && ids.has(r.work_id)));
            if (!occ.length) return null;
            return (
              <button
                type="button"
                title={`${occ.length} ausência(s) aguardando classificação`}
                aria-label="Ocorrência pendente"
                className="shrink-0"
                onClick={(e) => { e.stopPropagation(); if (api.canClassify) api.setOccOpen(occ[0]!); }}
              >
                <AlertTriangle className="h-4 w-4 fill-destructive text-destructive-foreground" />
              </button>
            );
          })()}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            title="Copiar mensagem"
            aria-label="Copiar mensagem"
            onClick={(e) => {
              e.stopPropagation();
              api.copyWorks(w, g.works);
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
          {editable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
              title="Retirar todos os colaboradores deste quadro"
              aria-label="Retirar todos"
              disabled={workRows.length === 0 || api.clearRows.isPending}
              onClick={(e) => {
                e.stopPropagation();
                api.setClearBox({ label: g.label, ids: workRows.map((r) => r.id) });
              }}
            >
              <ArrowDown className="h-3 w-3" />
            </Button>
          )}
          <button
            type="button"
            title="Copiar nomes e CPF"
            aria-label="Copiar nomes e CPF"
            onClick={(e) => {
              e.stopPropagation();
              api.copyPeopleCpf(workRows.map((r) => r.collaborator_id));
            }}
          >
            <Badge variant="outline" className="shrink-0 cursor-pointer px-1 py-0 text-[10px] hover:bg-accent">
              <Users className="mr-0.5 h-2.5 w-2.5" />
              {workRows.length}
            </Badge>
          </button>
          <span className="flex shrink-0 flex-col items-center gap-0.5">
          <button
            type="button"
            disabled={!editable}
            title={api.workPaysVt(w.id) ? "VT: todos recebem (clique para desligar)" : "VT: ninguém recebe (clique para ligar)"}
            aria-label="Alternar VT da obra"
            onClick={(e) => { e.stopPropagation(); api.setGroupVt.mutate({ ids: g.works.map((x) => x.id), value: !api.workPaysVt(w.id) }); }}
            className={`h-2.5 w-2.5 shrink-0 rounded-full border border-border ${api.workPaysVt(w.id) ? "bg-success" : "bg-muted-foreground/40"}`}
          />
          {(() => {
            // Ciclo: azul (prêmio viagem) → amarela (todos pernoite) → apagada → azul
            const allOn = workRows.length > 0 && workRows.every((r: any) => !!r.overnight);
            const tv = api.workPaysTravel(w.id);
            return (
              <button
                type="button"
                disabled={!editable}
                title={allOn ? "Pernoite: todos recebem R$ 25,00 (clique para desligar)" : tv ? "Prêmio viagem: ligado (clique para pernoite)" : "Prêmio viagem: desligado (clique para ligar)"}
                aria-label="Alternar prêmio viagem / pernoite da obra"
                onClick={(e) => {
                  e.stopPropagation();
                  const ids = workRows.map((r) => r.id);
                  const workIds = g.works.map((x) => x.id);
                  if (allOn) {
                    api.setGroupOvernight.mutate({ ids, value: false });
                    api.setGroupTravel.mutate({ ids: workIds, value: false });
                  } else if (tv) api.setGroupOvernight.mutate({ ids, value: true });
                  else api.setGroupTravel.mutate({ ids: workIds, value: true });
                }}
                className={`h-2.5 w-2.5 shrink-0 rounded-full border border-border ${allOn ? "bg-warning" : tv ? "bg-info" : "bg-muted-foreground/40"}`}
              />
            );
          })()}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <MapPin className="h-2.5 w-2.5" />
          {[w.clients?.city, w.entry_time?.slice(0, 5) && `Entrada ${w.entry_time.slice(0, 5)}`]
            .filter(Boolean)
            .join(" · ") || "Sem cliente vinculado"}
        </p>
        {g.works.some((x: any) => api.nightToday.has(x.id)) && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-info">
            <Moon className="h-2.5 w-2.5" /> Turno noturno (vira para o dia seguinte)
          </p>
        )}
        {(api.nightCarry?.get(w.client_id ?? "")?.length ?? 0) > 0 && (
          <div className="mt-1 rounded border border-info/40 bg-info/10 px-1.5 py-1 text-[10px]">
            <p className="flex items-center gap-1 font-medium text-info">
              <Moon className="h-2.5 w-2.5" /> Continuação do turno noturno de {formatBR(addDays(api.date, -1))}
            </p>
            <p className="text-muted-foreground">{api.nightCarry!.get(w.client_id ?? "")!.join(", ")}</p>
          </div>
        )}
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
          const p = api.personById.get(r.collaborator_id);
          return (
            <li
              key={r.id}
              draggable={editable}
              onDragStart={(e) => {
                e.stopPropagation();
                api.startDrag(e, { collaboratorId: r.collaborator_id, allocationId: r.id });
              }}
              onDragEnd={() => api.setDragging(null)}
              onDrop={(e) => {
                e.stopPropagation();
                e.preventDefault();
                api.setHoverWork(null);
                const payload = api.readPayload(e);
                api.setDragging(null);
                if (!payload || !editable) return;
                const same = payload.allocationId ? api.allocById.get(payload.allocationId) : api.allocByCollaborator.get(payload.collaboratorId);
                api.drop.mutate({ ...payload, workId: same && ids.has(same.work_id) ? same.work_id : r.work_id, beforeSort: r.sort_order - 0.5 });
              }}
              title={api.noticeTitle(r.collaborator_id)}
              className={cn("flex items-center gap-1.5 px-2 py-1 text-xs", api.noticeClass(r.collaborator_id))}
            >
              {editable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-xs font-medium leading-tight">
                  {(() => {
                    const st = api.ctx ? checkIntegration(api.ctx, r.work_id, r.collaborator_id, api.date).status : null;
                    return st === "missing" || st === "expired" ? (
                      <span title={st === "missing" ? "Sem integração com este cliente" : "Integração vencida"} className="shrink-0 font-bold text-destructive">!</span>
                    ) : null;
                  })()}
                  <span className="truncate">{p?.full_name ?? "—"}</span>
                </p>
                <p className="truncate text-[10px] leading-tight text-muted-foreground">
                  {(p?.position_id ? api.positionById.get(p.position_id) : r.position_id ? api.positionById.get(r.position_id) : null) ?? "Sem função"}
                </p>
              </div>
              {(() => {
                const occ = api.occByKey.get(`${r.work_id}|${r.collaborator_id}`);
                if (!occ) return null;
                return (
                  <button
                    type="button"
                    title="Ausência informada no RDO — clique para classificar"
                    aria-label="Classificar ocorrência"
                    className="shrink-0"
                    onClick={(e) => { e.stopPropagation(); if (api.canClassify) api.setOccOpen(occ); }}
                  >
                    <AlertTriangle className="h-4 w-4 fill-destructive text-destructive-foreground" />
                  </button>
                );
              })()}
              {(() => {
                const l = api.lodgingOf(r.collaborator_id);
                return l ? (
                  <span title={`Alojamento ${LODGING_LABEL[l]}`} className="shrink-0 rounded-[3px] border border-border px-1 text-[9px] font-semibold leading-[14px] text-muted-foreground">
                    {LODGING_TAG[l]}
                  </span>
                ) : null;
              })()}
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
                    api.removeRow.mutate(r.id);
                  }}
                >
                  <X className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
              <span className="flex shrink-0 flex-col items-center gap-0.5">
              {(() => {
                const vt = api.allocVtOn(r.work_id, r.collaborator_id, r.vt_override);
                return (
                  <button
                    type="button"
                    disabled={!editable}
                    title={`${vt ? "Recebe VT" : "Sem VT"}${r.vt_override !== null && r.vt_override !== undefined ? " (exceção)" : ""}`}
                    aria-label="Alternar VT do colaborador"
                    onClick={(e) => { e.stopPropagation(); api.toggleAllocVt.mutate({ id: r.id, workId: r.work_id, collaboratorId: r.collaborator_id, current: vt }); }}
                    className={`h-2 w-2 shrink-0 rounded-full ${vt ? "bg-success" : "bg-muted-foreground/40"}`}
                  />
                );
              })()}
              {(() => {
                // Ciclo: azul (prêmio viagem) → amarela (pernoite R$ 25) → apagada → azul
                const tb = api.travelInfo?.off.has(r.collaborator_id) ? false : r.travel_bonus_override ?? api.defaultAllocTravel(r.work_id, r.collaborator_id);
                const on = !!(r as any).overnight;
                return (
                  <button
                    type="button"
                    disabled={!editable}
                    title={on ? "Pernoite: R$ 25,00 de prêmio viagem" : tb ? "Recebe prêmio viagem (clique para pernoite)" : "Sem prêmio viagem"}
                    aria-label="Alternar prêmio viagem / pernoite do colaborador"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (on) api.toggleOvernight.mutate({ id: r.id, current: true, travelOff: api.defaultAllocTravel(r.work_id, r.collaborator_id) ? false : null });
                      else if (tb) api.toggleOvernight.mutate({ id: r.id, current: false });
                      else api.toggleAllocTravel.mutate({ id: r.id, workId: r.work_id, collaboratorId: r.collaborator_id, current: tb });
                    }}
                    className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-warning" : tb ? "bg-info" : "bg-muted-foreground/40"}`}
                  />
                );
              })()}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

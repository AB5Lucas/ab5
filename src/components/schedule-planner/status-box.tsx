import { memo, type MutableRefObject } from "react";
import { Copy, GripVertical, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { copyToClipboard, vtBoxDefault } from "@/components/schedule-planner/boxes";
import type { PlannerApi, PlannerEntry } from "@/components/schedule-planner/planner-api";

/**
 * Caixa de situação (folga, atestado, treinamento, integração...) da Programação. Memorizada como o WorkBox:
 * redesenha só quando mudam as pessoas da caixa, o arrastar sobre ela, a edição do título ou os dados do dia (`version`).
 */
export const StatusBox = memo(function StatusBox({
  b,
  boxRows,
  autoRows,
  isHover,
  editing,
  openEntry,
  editable,
  apiRef,
}: {
  b: { key: string; label: string };
  boxRows: PlannerEntry[];
  autoRows: { id: string; note: string }[];
  isHover: boolean;
  editing: boolean;
  openEntry: string | null;
  editable: boolean;
  version: string;
  apiRef: MutableRefObject<PlannerApi>;
}) {
  const api = apiRef.current;
  const nameOf = (id: string) => api.personById.get(id)?.full_name ?? "";
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    api.setHoverBox(null);
    const p = api.readPayload(e);
    api.setDragging(null);
    if (!p || !editable) return;
    api.dropBox.mutate({ ...p, boxKey: b.key });
  };
  const handleOver = (e: React.DragEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    api.setHoverBox(b.key);
  };
  return (
    <section
      onDragOver={handleOver}
      onDragLeave={() => api.setHoverBox((h) => (h === b.key ? null : h))}
      onDrop={handleDrop}
      className={cn(
        "panel flex h-72 flex-col overflow-hidden border-dashed transition",
        isHover && "ring-2 ring-primary",
      )}
    >
      <header className="border-b border-border bg-muted/60 px-2 py-1.5">
        <div className="flex items-start gap-1.5">
          {b.key === "personalizada" && editing ? (
            <Input
              autoFocus
              defaultValue={b.label}
              className="h-6 flex-1 px-1 text-[11px] uppercase"
              onBlur={(e) => {
                api.setEditingBox(null);
                if (e.target.value.trim() !== b.label) api.saveBoxTitle.mutate({ key: b.key, title: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") api.setEditingBox(null);
              }}
            />
          ) : (
            <h2
              className={cn(
                "font-display flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide",
                b.key === "personalizada" && editable && "cursor-text hover:underline",
              )}
              title={b.key === "personalizada" && editable ? "Clique para editar o título" : undefined}
              onClick={() => b.key === "personalizada" && editable && api.setEditingBox(b.key)}
            >
              {b.label}
            </h2>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            title="Copiar mensagem"
            aria-label="Copiar mensagem"
            onClick={(e) => {
              e.stopPropagation();
              const people = [
                ...autoRows.map((a) => ({ id: a.id, name: nameOf(a.id) })),
                ...boxRows.map((r) => ({ id: r.collaborator_id, name: nameOf(r.collaborator_id) })),
              ].filter((x) => x.name);
              void copyToClipboard(api.buildBoxMessage(b.key, b.label, people.map((x) => x.name), people.map((x) => x.id)));
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <button
            type="button"
            title="Copiar nomes e CPF"
            aria-label="Copiar nomes e CPF"
            onClick={(e) => {
              e.stopPropagation();
              api.copyPeopleCpf([...autoRows.map((a) => a.id), ...boxRows.map((r) => r.collaborator_id)]);
            }}
          >
            <Badge variant="outline" className="shrink-0 cursor-pointer px-1 py-0 text-[10px] hover:bg-accent">
              <Users className="mr-0.5 h-2.5 w-2.5" />
              {boxRows.length + autoRows.length}
            </Badge>
          </button>
          {vtBoxDefault(b.key) !== null && (
            <span className="mt-1 flex shrink-0 flex-col items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              disabled={!editable}
              aria-label="Alternar VT da caixa"
              title={
                b.key === "aso"
                  ? api.boxPaysVt(b.key)
                    ? "VT adicional ligado: 2 VTs (clique para desligar)"
                    : "Somente o VT do ASO: 1 VT (clique para ligar o adicional)"
                  : api.boxPaysVt(b.key)
                    ? "VT: todos recebem (clique para desligar)"
                    : "VT: ninguém recebe (clique para ligar)"
              }
              onClick={(e) => { e.stopPropagation(); api.toggleBoxVt.mutate(b.key); }}
              className={`h-2.5 w-2.5 min-w-0 shrink-0 rounded-full border border-border p-0 ${api.boxPaysVt(b.key) ? "bg-success hover:bg-success" : "bg-muted-foreground/40 hover:bg-muted-foreground/40"}`}
            />
            {b.key === "personalizada" && api.travelDot(b.key)}
            </span>
          )}
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
          const p = api.personById.get(a.id);
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
                  {(p?.position_id ? api.positionById.get(p.position_id) : null) ?? "Sem função"}
                </p>
              </div>
              <Badge
                variant={a.note === "Cadastrado" ? "secondary" : "default"}
                className="shrink-0 px-1 py-0 text-[9px]"
              >
                {a.note}
              </Badge>
              {vtBoxDefault(b.key) !== null && api.personBenefits(b.key, a.id)}
            </li>
          );
        })}
        {boxRows.map((entry) => {
          const p = api.personById.get(entry.collaborator_id);
          return (
            <li
              key={entry.id}
              draggable={editable}
              onDragStart={(e) =>
                api.startDrag(e, {
                  collaboratorId: entry.collaborator_id,
                  allocationId: null,
                  entryId: entry.id,
                })
              }
              onDragEnd={() => api.setDragging(null)}
              onDragOver={handleOver}
              onDrop={handleDrop}
              title={api.noticeTitle(entry.collaborator_id)}
              className={cn("flex items-center gap-1.5 px-2 py-1 text-xs", api.noticeClass(entry.collaborator_id))}
            >
              {editable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => api.setOpenEntry((s) => (s === entry.id ? null : entry.id))}>
                <p className="truncate text-xs font-medium leading-tight">{p?.full_name ?? "—"}</p>
                <p className="truncate text-[10px] leading-tight text-muted-foreground">
                  {(p?.position_id ? api.positionById.get(p.position_id) : null) ?? "Sem função"}
                </p>
                {openEntry === entry.id && (
                  <p className="text-[10px] leading-tight text-primary">
                    {api.rdoOrigin?.get(entry.collaborator_id)?.length
                      ? `Escalado em: ${api.rdoOrigin.get(entry.collaborator_id)!.join(", ")}`
                      : "Não veio do RDO"}
                  </p>
                )}
              </div>
              {vtBoxDefault(b.key) !== null && api.personBenefits(b.key, entry.collaborator_id)}
              {editable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label="Remover da caixa"
                  onClick={() => void api.askRemoveEntry(entry.id)}
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
});

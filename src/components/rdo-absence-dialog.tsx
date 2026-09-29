import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FINAL_CLASSES, REPORTED_REASONS, reasonLabel } from "@/lib/rdo";

/**
 * Janela única para:
 *  - mode="report": encarregado informa o motivo da ausência;
 *  - mode="classify": administração define a classificação definitiva.
 */
export function RdoAbsenceDialog({
  open,
  onOpenChange,
  mode,
  collaboratorName,
  workName,
  date,
  reportedReason,
  reportedNote,
  busy,
  onConfirm,
  onKeep,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "report" | "classify";
  collaboratorName: string;
  workName?: string | undefined;
  date?: string | undefined;
  reportedReason?: string | null | undefined;
  reportedNote?: string | null | undefined;
  busy?: boolean | undefined;
  onConfirm: (key: string, note: string) => void;
  onKeep?: (() => void) | undefined;
}) {
  const [choice, setChoice] = useState<string>("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setChoice(mode === "report" ? (reportedReason ?? "") : "");
      setNote(mode === "report" ? (reportedNote ?? "") : "");
    }
  }, [open, mode, reportedReason, reportedNote]);

  const options = mode === "report" ? REPORTED_REASONS : FINAL_CLASSES;
  const needsNote = mode === "report" && choice === "outro";
  const canSave = !!choice && (!needsNote || note.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "report" ? "Não compareceu" : "Classificar ocorrência"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <p className="font-semibold">{collaboratorName}</p>
          {workName && <p className="text-muted-foreground">{workName}</p>}
          {date && <p className="text-muted-foreground">{date.split("-").reverse().join("/")}</p>}
          {mode === "classify" && (
            <div className="mt-2 rounded border border-border bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Motivo informado pelo encarregado</p>
              <p className="font-medium">{reasonLabel(reportedReason)}</p>
              {reportedNote && <p className="mt-1 text-xs">Obs.: {reportedNote}</p>}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setChoice(o.key)}
              className={cn(
                "min-h-12 rounded-md border px-3 text-sm font-medium transition",
                choice === o.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {mode === "report" && (
          <Textarea
            placeholder={needsNote ? "Descreva o motivo (obrigatório)" : "Observação (opcional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <div className={cn("grid gap-2", mode === "classify" && onKeep ? "grid-cols-[1fr_1fr_2fr]" : "grid-cols-2")}>
          <Button variant="outline" className="w-full min-w-0 px-2" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {mode === "classify" && onKeep && (
            <Button variant="secondary" className="w-full min-w-0 px-2" disabled={busy} onClick={onKeep}>
              Manter
            </Button>
          )}
          <Button className="w-full min-w-0 px-2" disabled={!canSave || busy} onClick={() => onConfirm(choice, note.trim())}>
            {mode === "report" ? "Registrar ausência" : "Confirmar classificação"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

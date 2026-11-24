import { useState } from "react";
import { ChevronDown, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Botão de desfazer/refazer como no Office: clique = um passo; a seta abre a lista e desfaz/refaz até o passo escolhido. */
function HistoryButton({ kind, labels, onApply }: { kind: "undo" | "redo"; labels: string[]; onApply: (steps: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const Icon = kind === "undo" ? Undo2 : Redo2;
  const name = kind === "undo" ? "Desfazer" : "Refazer";
  const keys = kind === "undo" ? "Ctrl+Z" : "Ctrl+Y";
  const disabled = !labels.length;
  return (
    <div className="inline-flex">
      <Button variant="outline" size="sm" className="rounded-r-none px-2" disabled={disabled} aria-label={name}
        title={disabled ? `${name} (${keys})` : `${name}: ${labels[0]} (${keys})`} onClick={() => onApply(1)}>
        <Icon className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); setHover(0); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="-ml-px w-5 rounded-l-none px-0" disabled={disabled} aria-label={`Lista de passos para ${name.toLowerCase()}`}>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1" align="start" data-history-list>
          <div className="max-h-72 overflow-y-auto" onMouseLeave={() => setHover(0)}>
            {labels.map((l, i) => (
              <button key={i} type="button" onMouseEnter={() => setHover(i)}
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${i <= hover ? "bg-accent" : ""}`}
                onClick={() => { setOpen(false); onApply(i + 1); }}>
                {l}
              </button>
            ))}
          </div>
          <p className="border-t border-border px-2 pt-1 text-[11px] text-muted-foreground">{name} {hover + 1} {hover ? "passos" : "passo"}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function UndoRedoButtons({ undoLabels, redoLabels, onUndo, onRedo }: {
  undoLabels: string[]; redoLabels: string[]; onUndo: (steps: number) => void; onRedo: (steps: number) => void;
}) {
  return (
    <div className="flex gap-1">
      <HistoryButton kind="undo" labels={undoLabels} onApply={onUndo} />
      <HistoryButton kind="redo" labels={redoLabels} onApply={onRedo} />
    </div>
  );
}

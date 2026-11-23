/**
 * Filtro de seleção múltipla padrão do sistema (modelo do filtro de Veículos da
 * Transporte): título em cima, botão com ícone de filtro e quadro com caixas de marcar.
 *
 * - mode "pick" (padrão): `values` = escolhidos; vazio = todos (linha "Todos" no topo).
 * - mode "show": `values` = itens exibidos; todos marcados = sem filtro
 *   (atalhos Marcar todos / Desmarcar todos).
 * Com mais de 8 opções aparece uma busca no topo do quadro.
 */
import { useId, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiFilterOption = { value: string; label: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MultiFilter({
  title,
  options,
  values,
  onChange,
  mode = "pick",
  allLabel = "Todos",
  hint,
  className,
  labelClassName,
}: {
  title: string;
  options: MultiFilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  mode?: "pick" | "show";
  allLabel?: string;
  /** Frase curta no topo do quadro (ex.: "Marque os veículos exibidos"). */
  hint?: string;
  /** Largura do botão (padrão w-48). */
  className?: string;
  /** Classe do título (ex.: "text-xs" onde os outros títulos da barra são menores). */
  labelClassName?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const set = useMemo(() => new Set(values), [values]);
  const known = options.filter((o) => set.has(o.value));
  const total = options.length;
  const filtered = mode === "show" ? known.length < total : known.length > 0;
  const summary = !filtered
    ? allLabel
    : mode === "show"
      ? `${known.length} de ${total}`
      : known.length === 1
        ? known[0]!.label
        : `${known.length} selecionados`;
  const count = mode === "show" ? total - known.length : known.length;
  const shown = q.trim() ? options.filter((o) => norm(o.label).includes(norm(q.trim()))) : options;
  const toggle = (v: string, on: boolean) => onChange(on ? [...values.filter((x) => x !== v), v] : values.filter((x) => x !== v));

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={cn("block", labelClassName)}>{title}</Label>
      <Popover onOpenChange={(o) => { if (o) setQ(""); }}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className={cn("w-48 justify-start font-normal", className)} title={known.map((o) => o.label).join(", ")}>
            <Filter className="h-4 w-4 shrink-0" />
            <span className={cn("truncate", !filtered && "text-muted-foreground")}>{summary}</span>
            {filtered && count > 0 && (
              <Badge variant="secondary" className="ml-auto shrink-0">{mode === "show" ? `${count} ocultos` : count}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-80 w-72 overflow-y-auto" align="start">
          {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
          {total > 8 && (
            <Input className="mb-2 h-8" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {mode === "show" ? (
            <div className="mb-2 flex gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onChange(options.map((o) => o.value))}>Marcar todos</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onChange([])}>Desmarcar todos</Button>
            </div>
          ) : (
            <label className="mb-2 flex items-center gap-2 text-sm">
              <Checkbox checked={!known.length} onCheckedChange={() => onChange([])} />
              <span>{allLabel}</span>
            </label>
          )}
          <div className="space-y-2">
            {shown.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={set.has(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {!shown.length && <p className="text-xs text-muted-foreground">Nada encontrado.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

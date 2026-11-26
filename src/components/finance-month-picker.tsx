import { memo, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { financeMonthRange } from "@/lib/finance-month-selection";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Only this small control renders during a drag; financial calculations run on release. */
export const FinanceMonthPicker = memo(function FinanceMonthPicker({ value, onChange }: {
  value: number[];
  onChange: (months: number[]) => void;
}) {
  const [preview, setPreview] = useState<number[] | null>(null);
  const gesture = useRef<{ id: number; anchor: number; end: number; rects: { month: number; rect: DOMRect }[] } | null>(null);
  const selected = preview ?? value;

  const monthAt = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const month = Number(target.closest("[data-month]")?.getAttribute("data-month"));
    return month >= 1 && month <= 12 ? month : null;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const hit = g.rects.find(({ rect }) => e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
    if (!hit || hit.month === g.end) return;
    g.end = hit.month;
    setPreview(financeMonthRange(g.anchor, g.end));
  };
  const finish = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (commit) move(e);
    gesture.current = null;
    setPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (commit) onChange(financeMonthRange(g.anchor, g.end));
  };

  return (
    <div className="flex flex-wrap items-center rounded-2xl border bg-muted/40 p-0.5 sm:rounded-full">
      <div role="group" aria-label="Meses" className="grid touch-none select-none grid-cols-6 sm:grid-cols-12"
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          const month = monthAt(e.target);
          if (month == null) return;
          const rects = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-month]")).map((el) => ({ month: Number(el.dataset['month']), rect: el.getBoundingClientRect() }));
          gesture.current = { id: e.pointerId, anchor: month, end: month, rects };
          e.currentTarget.setPointerCapture(e.pointerId);
          setPreview([month]);
        }}
        onPointerMove={move}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        onLostPointerCapture={(e) => finish(e, false)}
        onContextMenu={(e) => e.preventDefault()}>
        {MONTHS.map((label, i) => {
          const month = i + 1;
          return <Button key={label} type="button" variant="ghost" size="sm" data-month={month}
            aria-pressed={selected.includes(month)}
            onClick={(e) => { if (e.detail === 0) onChange([month]); }}
            className={cn("h-7 rounded-none px-2.5 py-1 text-xs transition-colors duration-100 motion-reduce:transition-none", selected.includes(month)
              ? cn("bg-foreground text-background hover:bg-foreground hover:text-background", !selected.includes(month - 1) && "rounded-l-full", !selected.includes(month + 1) && "rounded-r-full")
              : "rounded-full text-muted-foreground hover:text-foreground")}>
            {label}
          </Button>;
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
        onClick={() => onChange(value.length === 12 ? [] : financeMonthRange(1, 12))}>
        {value.length === 12 ? "Limpar" : "Ano todo"}
      </Button>
    </div>
  );
});
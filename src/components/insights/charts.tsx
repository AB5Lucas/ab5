/**
 * Gráficos leves em SVG próprio (sem recharts) para os blocos vivos: anel, barra, barra empilhada e mini-linha.
 * A cor vem de `currentColor` (classe text-*), então seguem o tema claro/escuro.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Anel de progresso (0–1) com rótulo no centro. */
export function Ring({ value, size = 48, stroke = 5, className, children, title }: {
  value: number; size?: number | undefined; stroke?: number | undefined; className?: string | undefined; children?: ReactNode | undefined; title?: string | undefined;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = clamp01(value);
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} title={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="currentColor" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="insight-ring" />
      </svg>
      {children != null && <span className="absolute text-[10px] font-semibold tabular-nums text-foreground">{children}</span>}
    </div>
  );
}

/** Barra horizontal fina (valor ÷ máximo). */
export function Bar({ value, max = 1, className, trackClassName, title }: { value: number; max?: number | undefined; className?: string | undefined; trackClassName?: string | undefined; title?: string | undefined }) {
  const pct = clamp01(max > 0 ? value / max : 0) * 100;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", trackClassName)} title={title}>
      <div className={cn("insight-bar h-full rounded-full bg-primary", className)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export type StackPart = { key: string; label: string; value: number; className: string };

/** Barra empilhada (partes de um total); clicar numa parte chama onPick. */
export function StackedBar({ parts, onPick, className }: { parts: StackPart[]; onPick?: ((key: string) => void) | undefined; className?: string | undefined }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
        <button key={p.key} type="button" title={`${p.label}: ${p.value.toLocaleString("pt-BR")} (${Math.round((p.value / total) * 100)}%)`}
          aria-label={`${p.label}: ${p.value}`}
          onClick={(e) => { if (!onPick) return; e.stopPropagation(); onPick(p.key); }}
          className={cn("insight-bar h-full transition-opacity hover:opacity-80", p.className, !onPick && "cursor-default")}
          style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

/** Mini-linha (sparkline) dos valores na ordem dada. */
export function Sparkline({ values, width = 84, height = 24, className, title }: { values: number[]; width?: number | undefined; height?: number | undefined; className?: string | undefined; title?: string | undefined }) {
  if (!values.length) return null;
  const max = Math.max(...values, 0);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => (max > 0 ? height - 2 - (v / max) * (height - 4) : height - 2);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible text-primary", className)} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <circle cx={(values.length - 1) * step} cy={y(last)} r={2} fill="currentColor" />
    </svg>
  );
}

/** Legenda pequena com bolinha colorida. */
export function Legend({ items }: { items: { label: string; className: string; value?: ReactNode | undefined }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", i.className)} />{i.label}{i.value != null && <b className="font-semibold text-foreground">{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

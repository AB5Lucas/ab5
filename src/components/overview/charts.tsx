/**
 * Gráficos da visão geral dos módulos (estilo monocromático: cartões claros, um escuro em destaque, barras hachuradas
 * com a barra atual sólida, medidor semicircular e linha com balão). SVG próprio, cores dos tokens do tema.
 */
import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";

export function OverviewCard({ title, to, linkLabel, dark, className, bodyClassName, children, hint }: {
  title: string; to: string; linkLabel: string; dark?: boolean; className?: string; bodyClassName?: string; children: ReactNode; hint?: string;
}) {
  return (
    <Link to={to} title={hint}
      className={cn("ov-card group relative flex flex-col rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dark ? "border-transparent bg-foreground text-background" : "border-border bg-card", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-xs font-medium", dark ? "text-background/70" : "text-muted-foreground")}>{title}</p>
        <span title={linkLabel} aria-label={linkLabel} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-transform duration-300 group-hover:rotate-45",
          dark ? "border-background/25" : "border-border")}><ArrowUpRight className="h-3.5 w-3.5" /></span>
      </div>
      {/* Sem o texto do link embaixo: o conteúdo vai até o fim do quadro; a seta de cima mostra o destino no mouse. */}
      <div className={cn("mt-2 flex-1", bodyClassName)}>{children}</div>
    </Link>
  );
}

export function Big({ value, delta, dark }: { value: string | number; delta?: number | null; dark?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-3xl font-semibold tracking-tight tabular-nums"><CountUp value={value} /></span>
      {delta != null && Number.isFinite(delta) && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          dark ? "bg-background/15 text-background" : delta >= 0 ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
        </span>
      )}
    </div>
  );
}

/** Mini barras (dentro de cartão): a última sólida, as demais claras. */
export function MiniBars({ values, dark }: { values: number[]; dark?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <span key={i} className={cn("ov-grow w-[5px] rounded-sm", i === values.length - 1 ? (dark ? "bg-background" : "bg-foreground") : dark ? "bg-background/30" : "bg-foreground/20")}
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, animationDelay: `${i * 30}ms` }} />
      ))}
    </div>
  );
}

/** Medidor semicircular (0–100%). */
export function Gauge({ pct, label, sub, dark }: { pct: number; label: string; sub?: string; dark?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 70, c = Math.PI * r;
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 180 100" className="w-full">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" strokeWidth="12" strokeLinecap="round" className={dark ? "stroke-background/15" : "stroke-muted"} strokeDasharray="2 5" />
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" strokeWidth="12" strokeLinecap="round" className={cn("ov-gauge", dark ? "stroke-background" : "stroke-foreground")}
          style={{ strokeDasharray: c, ["--ov-off" as string]: c * (1 - p / 100), strokeDashoffset: c * (1 - p / 100) }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="font-display text-3xl font-semibold tabular-nums"><CountUp value={`${Math.round(p)}%`} /></p>
        <p className={cn("text-[11px]", dark ? "text-background/70" : "text-muted-foreground")}>{label}</p>
        {sub && <p className={cn("text-[10px]", dark ? "text-background/60" : "text-muted-foreground")}>{sub}</p>}
      </div>
    </div>
  );
}

/** Barras hachuradas com a barra em destaque sólida e balão ao passar o mouse. */
export function HatchBars({ data, format, highlight }: { data: { label: string; value: number; tip?: string }[]; format: (v: number) => string; highlight?: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const sel = hover ?? highlight ?? data.length - 1;
  const w = 100 / Math.max(1, data.length);
  return (
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-44 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`h${id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.6" className="stroke-foreground/25" strokeWidth="0.6" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={50 - g * 46} y2={50 - g * 46} className="stroke-border" strokeWidth="0.15" strokeDasharray="0.8 0.8" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const h = Math.max(1.2, (d.value / max) * 46);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={50} fill="transparent" />
              <rect className="ov-bar" x={i * w + w * 0.18} y={50 - h} width={w * 0.64} height={h} rx={1.2}
                fill={i === sel ? "var(--color-foreground)" : `url(#h${id})`} stroke={i === sel ? "none" : "var(--color-border)"} strokeWidth="0.2"
                style={{ animationDelay: `${i * 40}ms` }} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-muted-foreground">{data.map((d, i) => <span key={i} className={cn("flex-1 text-center", i === sel && "font-semibold text-foreground")}>{d.label}</span>)}</div>
      {data[sel] && (
        <div className="pointer-events-none absolute top-0 rounded-lg border bg-popover px-2 py-1 text-[11px] shadow-md transition-all duration-200"
          style={{ left: `clamp(0px, calc(${(sel + 0.5) * w}% - 60px), calc(100% - 120px))`, width: 120 }}>
          <p className="font-medium">{data[sel]!.tip ?? data[sel]!.label}</p>
          <p className="tabular-nums text-muted-foreground">{format(data[sel]!.value)}</p>
        </div>
      )}
    </div>
  );
}

/** Linha suave com área e ponto/balão ao passar o mouse; segunda série tracejada (comparação). */
export function LineArea({ data, format, height = "h-44", className }: { data: { label: string; a: number; b?: number; tip?: string }[]; format: (d: { a: number; b?: number }) => string; height?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b ?? 0]));
  const n = Math.max(1, data.length - 1);
  const pt = (i: number, v: number) => [(i / n) * 100, 46 - (v / max) * 42] as const;
  const path = (key: "a" | "b") => data.map((d, i) => {
    const [x, y] = pt(i, (d[key] as number) ?? 0);
    if (!i) return `M ${x} ${y}`;
    const [px, py] = pt(i - 1, (data[i - 1]![key] as number) ?? 0);
    const cx = (px + x) / 2;
    return `C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }).join(" ");
  const sel = hover ?? data.length - 1;
  const [sx, sy] = pt(sel, data[sel]?.a ?? 0);
  return (
    <div className={cn("relative", className)}>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className={cn(height, "w-full overflow-visible")}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.round(((e.clientX - r.left) / r.width) * n)); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-foreground)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--color-foreground)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {data.some((d) => d.b != null) && <path d={path("b")} fill="none" className="stroke-muted-foreground/60" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
        <path d={`${path("a")} L 100 50 L 0 50 Z`} fill={`url(#g${id})`} className="ov-fade" />
        <path d={path("a")} fill="none" className="ov-fade stroke-foreground" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <line x1={sx} x2={sx} y1={0} y2={50} className="stroke-border" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow" style={{ left: `${sx}%`, top: `${(sy / 50) * 100}%` }} />
      {data[sel] && (
        <div className="pointer-events-none absolute top-0 rounded-lg border bg-popover px-2 py-1 text-[11px] shadow-md"
          style={{ left: `clamp(0px, calc(${sx}% - 70px), calc(100% - 140px))`, width: 140 }}>
          <p className="font-medium">{data[sel]!.tip ?? data[sel]!.label}</p>
          <p className="tabular-nums text-muted-foreground">{format(data[sel]!)}</p>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
    </div>
  );
}

/** Linhas do mesmo desenho do LineArea, com várias séries (ex.: despesas por tipo). O quadro só aparece no mouse. */
export type LineSeries = { key: string; label: string; stroke: string; dash?: string; width?: number; area?: boolean };
export function MultiLine({ data, series, format, height = "h-20", className }: {
  data: { label: string; tip?: string; values: Record<string, number> }[]; series: LineSeries[]; format: (v: number) => string; height?: string; className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const n = Math.max(1, data.length - 1);
  const pt = (i: number, v: number) => [(i / n) * 100, 46 - (v / max) * 42] as const;
  const path = (key: string) => data.map((d, i) => {
    const [x, y] = pt(i, d.values[key] ?? 0);
    if (!i) return `M ${x} ${y}`;
    const [px, py] = pt(i - 1, data[i - 1]!.values[key] ?? 0);
    const cx = (px + x) / 2;
    return `C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }).join(" ");
  const sx = hover != null ? pt(hover, 0)[0] : 0;
  return (
    <div className={cn("relative", className)}>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className={cn(height, "w-full overflow-visible")}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)))); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`m${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-foreground)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--color-foreground)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {series.filter((s) => s.area).map((s) => <path key={`a${s.key}`} d={`${path(s.key)} L 100 50 L 0 50 Z`} fill={`url(#m${id})`} className="ov-fade" />)}
        {series.map((s) => <path key={s.key} d={path(s.key)} fill="none" className={cn("ov-fade", s.stroke)} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash} vectorEffect="non-scaling-stroke" />)}
        {hover != null && <line x1={sx} x2={sx} y1={0} y2={50} className="stroke-border" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover != null && data[hover] && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-lg border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
          style={{ left: `clamp(0px, calc(${sx}% - 80px), calc(100% - 160px))`, width: 160 }}>
          <p className="font-medium">{data[hover]!.tip ?? data[hover]!.label}</p>
          {series.map((s) => <p key={s.key} className="flex justify-between gap-2 tabular-nums text-muted-foreground"><span>{s.label}</span><span>{format(data[hover]!.values[s.key] ?? 0)}</span></p>)}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
    </div>
  );
}

/** Barras horizontais (ranking), com valor à direita. */
export function RankBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.label} className="text-xs">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="tabular-nums text-muted-foreground">{format(r.value)}</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="ov-widen h-full rounded-full bg-foreground" style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 60}ms` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Medidor meia-roda de margem (0 a 50%) no estilo do medidor escuro, com traço na meta (23%). */
export function MarginGauge({ pct, goal = 23, max = 50, label, sub }: { pct: number | null; goal?: number; max?: number; label?: string; sub?: string }) {
  const p = Math.max(0, Math.min(max, pct ?? 0));
  const r = 70, c = Math.PI * r;
  const at = (v: number, rr: number) => { const a = Math.PI * (1 - v / max); return [90 + rr * Math.cos(a), 90 - rr * Math.sin(a)] as const; };
  const [g1x, g1y] = at(goal, r - 11), [g2x, g2y] = at(goal, r + 11), [tx, ty] = at(goal, r + 20);
  const good = (pct ?? -1) >= goal;
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 180 104" className="w-full overflow-visible">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-background/15" strokeDasharray="2 5" />
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" strokeWidth="12" strokeLinecap="round" className="ov-gauge stroke-background"
          style={{ strokeDasharray: c, ["--ov-off" as string]: c * (1 - p / max), strokeDashoffset: c * (1 - p / max) }} />
        <line x1={g1x} y1={g1y} x2={g2x} y2={g2y} className="stroke-background" strokeWidth="2.5" strokeLinecap="round" />
        <text x={tx} y={ty} textAnchor="middle" className="fill-background/70 text-[7px]">meta {goal}%</text>
        <text x="20" y="102" textAnchor="middle" className="fill-background/50 text-[6.5px]">0%</text>
        <text x="160" y="102" textAnchor="middle" className="fill-background/50 text-[6.5px]">{max}%</text>
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="font-display text-3xl font-semibold tabular-nums">{pct == null ? "—" : <CountUp value={`${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} />}</p>
        <p className="text-[11px] text-background/70">{good ? "acima da meta" : "abaixo da meta"}{label ? ` · ${label}` : ""}</p>
        {sub && <p className="text-[10px] text-background/55">{sub}</p>}
      </div>
    </div>
  );
}

/** Margem % por mês no estilo das barras hachuradas: na meta ou acima = barra cheia; abaixo = hachurada; linha da meta tracejada. */
export function MarginMonths({ data, goal = 23 }: { data: { label: string; pct: number | null; tip?: string; extra?: string }[]; goal?: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map((d) => d.pct ?? 0);
  const top = Math.max(goal + 10, ...vals, 10), bottom = Math.min(0, ...vals);
  const span = top - bottom;
  const y = (v: number) => 46 - ((v - bottom) / span) * 44;
  const w = 100 / Math.max(1, data.length);
  const sel = hover ?? data.length - 1;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-44 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`m${id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.6" className="stroke-foreground/35" strokeWidth="0.6" />
          </pattern>
        </defs>
        <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const v = d.pct ?? 0;
          const y1 = Math.min(y(v), y(0)), h = Math.max(0.8, Math.abs(y(v) - y(0)));
          const solid = v >= goal || i === sel;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={50} fill="transparent" />
              <rect className="ov-bar" x={i * w + w * 0.18} y={y1} width={w * 0.64} height={h} rx={1.2}
                fill={solid ? "var(--color-foreground)" : `url(#m${id})`} stroke={solid ? "none" : "var(--color-border)"} strokeWidth="0.2"
                opacity={i === sel || v >= goal ? 1 : 0.9} style={{ animationDelay: `${i * 40}ms` }} />
            </g>
          );
        })}
        <line x1="0" x2="100" y1={y(goal)} y2={y(goal)} className="stroke-foreground/60" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute right-0 rounded-full border bg-background px-1.5 text-[9px] text-muted-foreground" style={{ top: `calc(${(y(goal) / 50) * 100}% - 8px)` }}>meta {goal}%</span>
      <div className="mt-1 flex text-[10px] text-muted-foreground">{data.map((d, i) => <span key={i} className={cn("flex-1 text-center", i === sel && "font-semibold text-foreground")}>{d.label}</span>)}</div>
      {data[sel] && (
        <div className="pointer-events-none absolute top-0 rounded-lg border bg-popover px-2 py-1 text-[11px] shadow-md" style={{ left: `clamp(0px, calc(${(sel + 0.5) * w}% - 75px), calc(100% - 150px))`, width: 150 }}>
          <p className="font-medium">{data[sel]!.tip ?? data[sel]!.label}</p>
          <p className="tabular-nums">{data[sel]!.pct == null ? "sem faturamento" : `margem ${data[sel]!.pct!.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</p>
          {data[sel]!.extra && <p className="tabular-nums text-muted-foreground">{data[sel]!.extra}</p>}
        </div>
      )}
    </div>
  );
}

/** Faturado por mês em barras hachuradas (mês em destaque cheio) e custos como linha suave por cima; balão com margem. */
export function BilledVsCost({ data, format }: { data: { label: string; billed: number; cost: number; tip?: string; marginPct: number | null }[]; format: (v: number) => string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.billed, d.cost]));
  const w = 100 / Math.max(1, data.length);
  const sel = hover ?? data.length - 1;
  const pts = data.map((d, i) => [(i + 0.5) * w, 50 - (d.cost / max) * 46] as const);
  const line = pts.map(([x, y], i) => {
    if (!i) return `M ${x} ${y}`;
    const [px, py] = pts[i - 1]!; const cx = (px + x) / 2;
    return `C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }).join(" ");
  return (
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-44 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`c${id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.6" className="stroke-foreground/25" strokeWidth="0.6" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={50 - g * 46} y2={50 - g * 46} className="stroke-border" strokeWidth="0.15" strokeDasharray="0.8 0.8" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const hb = Math.max(1.2, (d.billed / max) * 46);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={50} fill="transparent" />
              <rect className="ov-bar" x={i * w + w * 0.18} y={50 - hb} width={w * 0.64} height={hb} rx={1.2}
                fill={i === sel ? "var(--color-foreground)" : `url(#c${id})`} stroke={i === sel ? "none" : "var(--color-border)"} strokeWidth="0.2" style={{ animationDelay: `${i * 40}ms` }} />
            </g>
          );
        })}
        <path d={line} fill="none" className="ov-draw stroke-muted-foreground" strokeWidth="1.5" strokeDasharray="0" vectorEffect="non-scaling-stroke" pathLength={1} />
      </svg>
      {pts.map(([x, y], i) => <span key={i} className={cn("pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background", i === sel ? "bg-foreground" : "bg-muted-foreground")} style={{ left: `${x}%`, top: `${(y / 50) * 176}px` }} />)}
      <div className="mt-1 flex text-[10px] text-muted-foreground">{data.map((d, i) => <span key={i} className={cn("flex-1 text-center", i === sel && "font-semibold text-foreground")}>{d.label}</span>)}</div>
      <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-foreground" /> Faturado</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-muted-foreground" /> Custos (MO, transporte, materiais)</span>
      </div>
      {data[sel] && (
        <div className="pointer-events-none absolute top-0 rounded-lg border bg-popover px-2 py-1 text-[11px] shadow-md" style={{ left: `clamp(0px, calc(${(sel + 0.5) * w}% - 80px), calc(100% - 160px))`, width: 160 }}>
          <p className="font-medium">{data[sel]!.tip ?? data[sel]!.label}</p>
          <p className="tabular-nums">Faturado {format(data[sel]!.billed)}</p>
          <p className="tabular-nums text-muted-foreground">Custos {format(data[sel]!.cost)}</p>
          {data[sel]!.marginPct != null && <p className="tabular-nums">Margem {data[sel]!.marginPct!.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p>}
        </div>
      )}
    </div>
  );
}

/** Barra empilhada com legenda (composição de custos, situação do dia…). */
export function StackBar({ parts, format }: { parts: { label: string; value: number; className: string }[]; format: (v: number) => string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {parts.map((p, i) => <div key={p.label} className={cn("ov-widen h-full", p.className)} style={{ width: `${(p.value / total) * 100}%`, animationDelay: `${i * 80}ms` }} title={`${p.label}: ${format(p.value)}`} />)}
      </div>
      <div className="mt-2 grid gap-1 text-[11px]">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", p.className)} /><span className="text-muted-foreground">{p.label}</span>
            <span className="ml-auto tabular-nums">{format(p.value)}</span>
            <span className="w-9 text-right tabular-nums text-muted-foreground">{Math.round((p.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barras em toda a largura do cartão, com balão ao passar o mouse. */
export function HoverBars({ data, format, dark, height = "h-16" }: { data: { label: string; value: number; tip?: string }[]; format: (v: number) => string; dark?: boolean; height?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const sel = hover ?? data.length - 1;
  const d = data[sel];
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className={cn("flex w-full items-end gap-[2px]", height)}>
        {data.map((x, i) => (
          <span key={i} onMouseEnter={() => setHover(i)} className="flex h-full flex-1 items-end">
            <span className={cn("ov-grow w-full rounded-[3px] transition-all duration-500", i === sel ? (dark ? "bg-background" : "bg-foreground") : dark ? "bg-background/30" : "bg-foreground/20")}
              style={{ height: `${x.value > 0 ? Math.max(6, (x.value / max) * 100) : 3}%`, animationDelay: `${i * 20}ms` }} />
          </span>
        ))}
      </div>
      {d && (
        <div className={cn("mt-1 flex justify-between text-[10px] tabular-nums", dark ? "text-background/70" : "text-muted-foreground")}>
          <span>{d.tip ?? d.label}</span><span className="font-medium">{format(d.value)}</span>
        </div>
      )}
    </div>
  );
}

/** Linha de margens (%) com traço no zero; balão ao passar o mouse. Escala pelos valores (pontas extremas presas). */
export function MarginLine({ data }: { data: { label: string; pct: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="py-4 text-center text-[11px] text-muted-foreground">Sem margens no período.</p>;
  const sorted = [...data.map((d) => d.pct)].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!;
  const lo = Math.min(0, q(0.05)) - 5, hi = Math.max(0, q(0.95)) + 5;
  const vals = data.map((d) => Math.max(lo, Math.min(hi, d.pct)));
  const n = Math.max(1, data.length - 1);
  const y = (v: number) => 3 + ((hi - v) / (hi - lo)) * 44;
  const x = (i: number) => (data.length === 1 ? 50 : (i / n) * 100);
  const path = vals.map((v, i) => {
    if (!i) return `M ${x(0)} ${y(v)}`;
    const cx = (x(i - 1) + x(i)) / 2;
    return `C ${cx} ${y(vals[i - 1]!)}, ${cx} ${y(v)}, ${x(i)} ${y(v)}`;
  }).join(" ");
  const fmt = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const sel = hover;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-20 w-full overflow-visible"
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * n)))); }}>
        <line x1={0} x2={100} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/70" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" className="ov-fade stroke-foreground" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        {sel != null && <line x1={x(sel)} x2={x(sel)} y1={0} y2={50} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="pointer-events-none absolute -translate-y-1/2 text-[9px] text-muted-foreground" style={{ right: 0, top: `${(y(0) / 50) * 100}%` }}>0%</span>
      {sel != null && <span className={cn("pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full", data[sel]!.pct < 0 ? "bg-destructive" : "bg-foreground")} style={{ left: `${x(sel)}%`, top: `${(y(vals[sel]!) / 50) * 100}%` }} />}
      <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
        {sel != null ? <><span className="truncate">{data[sel]!.label}</span><span className="font-medium tabular-nums">{fmt(data[sel]!.pct)}</span></>
          : <><span>{fmt(sorted[sorted.length - 1]!)} maior</span><span>{fmt(sorted[0]!)} menor</span></>}
      </div>
    </div>
  );
}

/** Gráfico circular de uma fração (0–1) com o valor no meio. */
export function Donut({ frac, center, sub, size = "h-28 w-28" }: { frac: number; center: string; sub?: string; size?: string }) {
  const f = Math.max(0, Math.min(1, frac)), r = 38, c = 2 * Math.PI * r;
  return (
    <div className={cn("relative mx-auto", size)}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="12" className="stroke-muted" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="12" strokeLinecap="round" className="ov-gauge stroke-foreground"
          style={{ strokeDasharray: c, ["--ov-off" as string]: c * (1 - f), strokeDashoffset: c * (1 - f) }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold tabular-nums">{center}</span>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

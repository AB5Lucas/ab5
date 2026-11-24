/**
 * Gráficos da visão geral dos módulos (estilo monocromático: cartões claros, um escuro em destaque, barras hachuradas
 * com a barra atual sólida, medidor semicircular e linha com balão). SVG próprio, cores dos tokens do tema.
 */
import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";

export function OverviewCard({ title, to, linkLabel, dark, className, children, hint }: {
  title: string; to: string; linkLabel: string; dark?: boolean; className?: string; children: ReactNode; hint?: string;
}) {
  return (
    <Link to={to} title={hint}
      className={cn("ov-card group relative flex flex-col rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dark ? "border-transparent bg-foreground text-background" : "border-border bg-card", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-xs font-medium", dark ? "text-background/70" : "text-muted-foreground")}>{title}</p>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border transition-transform duration-300 group-hover:rotate-45",
          dark ? "border-background/25" : "border-border")}><ArrowUpRight className="h-3.5 w-3.5" /></span>
      </div>
      <div className="mt-2 flex-1">{children}</div>
      <p className={cn("mt-3 text-[11px] underline-offset-4 group-hover:underline", dark ? "text-background/70" : "text-muted-foreground")}>{linkLabel}</p>
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
export function LineArea({ data, format }: { data: { label: string; a: number; b?: number; tip?: string }[]; format: (d: { a: number; b?: number }) => string }) {
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
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-44 w-full overflow-visible"
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
        <path d={path("a")} fill="none" className="ov-draw stroke-foreground" strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={1} />
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

/** Medidor meia-roda de margem: 0 a 50%, com traço na meta (23%); acima da meta verde, abaixo vermelho da AB5. */
export function MarginGauge({ pct, goal = 23, max = 50, label }: { pct: number | null; goal?: number; max?: number; label?: string }) {
  const p = Math.max(0, Math.min(max, pct ?? 0));
  const r = 80, c = Math.PI * r;
  const pos = (v: number) => { const a = Math.PI * (1 - v / max); return [100 + r * Math.cos(a), 100 - r * Math.sin(a)] as const; };
  const [gx1, gy1] = (() => { const a = Math.PI * (1 - goal / max); return [100 + (r - 14) * Math.cos(a), 100 - (r - 14) * Math.sin(a)]; })();
  const [gx2, gy2] = (() => { const a = Math.PI * (1 - goal / max); return [100 + (r + 14) * Math.cos(a), 100 - (r + 14) * Math.sin(a)]; })();
  const good = (pct ?? 0) >= goal;
  const [nx, ny] = pos(p);
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <svg viewBox="0 0 200 112" className="w-full overflow-visible">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" strokeWidth="16" strokeLinecap="round" className="stroke-muted" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" strokeWidth="16" strokeLinecap="round"
          className={cn("ov-gauge", good ? "stroke-success" : "stroke-primary")}
          style={{ strokeDasharray: c, ["--ov-off" as string]: c * (1 - p / max), strokeDashoffset: c * (1 - p / max) }} />
        <line x1={gx1} y1={gy1} x2={gx2} y2={gy2} className="stroke-foreground" strokeWidth="2.5" strokeLinecap="round" />
        <text x={gx2 + (gx2 > 100 ? 4 : -4)} y={gy2 - 4} textAnchor={gx2 > 100 ? "start" : "end"} className="fill-muted-foreground text-[8px]">meta {goal}%</text>
        <circle cx={nx} cy={ny} r="5" className="fill-background stroke-foreground" strokeWidth="2" />
        <text x="20" y="111" textAnchor="middle" className="fill-muted-foreground text-[7px]">0%</text>
        <text x="180" y="111" textAnchor="middle" className="fill-muted-foreground text-[7px]">{max}%</text>
      </svg>
      <div className="absolute inset-x-0 bottom-3 text-center">
        <p className={cn("font-display text-4xl font-semibold tabular-nums", good ? "text-success" : "text-primary")}>{pct == null ? "—" : <CountUp value={`${(pct ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} />}</p>
        {label && <p className="text-[11px] text-muted-foreground">{label}</p>}
      </div>
    </div>
  );
}

/** Margem % por mês: barras (verde acima da meta, vermelho abaixo) com a linha tracejada da meta e balão. */
export function MarginMonths({ data, goal = 23 }: { data: { label: string; pct: number | null; tip?: string; extra?: string }[]; goal?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map((d) => d.pct ?? 0);
  const top = Math.max(goal + 10, ...vals, 10), bottom = Math.min(0, ...vals);
  const span = top - bottom;
  const y = (v: number) => 46 - ((v - bottom) / span) * 44;
  const w = 100 / Math.max(1, data.length);
  const sel = hover ?? data.length - 1;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-48 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
        <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const v = d.pct ?? 0;
          const y1 = Math.min(y(v), y(0)), h = Math.max(0.8, Math.abs(y(v) - y(0)));
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={50} fill="transparent" />
              <rect className="ov-bar" x={i * w + w * 0.2} y={y1} width={w * 0.6} height={h} rx={1}
                fill={d.pct == null ? "var(--color-muted)" : v >= goal ? "var(--color-success)" : "var(--color-primary)"}
                opacity={i === sel ? 1 : 0.55} style={{ animationDelay: `${i * 40}ms` }} />
            </g>
          );
        })}
        <line x1="0" x2="100" y1={y(goal)} y2={y(goal)} className="stroke-foreground" strokeWidth="1.2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute right-0 rounded bg-foreground px-1.5 text-[9px] text-background" style={{ top: `calc(${(y(goal) / 50) * 100}% - 8px)` }}>meta {goal}%</span>
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

/** Faturado × custos por mês: barra cheia = faturado, barra hachurada = custos; balão com margem. */
export function BilledVsCost({ data, format }: { data: { label: string; billed: number; cost: number; tip?: string; marginPct: number | null }[]; format: (v: number) => string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.billed, d.cost]));
  const w = 100 / Math.max(1, data.length);
  const sel = hover ?? data.length - 1;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-48 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`c${id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.6" className="stroke-primary/60" strokeWidth="0.7" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={50 - g * 46} y2={50 - g * 46} className="stroke-border" strokeWidth="0.15" strokeDasharray="0.8 0.8" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const hb = Math.max(0.8, (d.billed / max) * 46), hc = Math.max(0.8, (d.cost / max) * 46);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={50} fill="transparent" />
              <rect className="ov-bar" x={i * w + w * 0.14} y={50 - hb} width={w * 0.34} height={hb} rx={0.8} fill="var(--color-foreground)" opacity={i === sel ? 1 : 0.75} style={{ animationDelay: `${i * 40}ms` }} />
              <rect className="ov-bar" x={i * w + w * 0.52} y={50 - hc} width={w * 0.34} height={hc} rx={0.8} fill={`url(#c${id})`} stroke="var(--color-primary)" strokeOpacity="0.5" strokeWidth="0.2" style={{ animationDelay: `${i * 40 + 20}ms` }} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-muted-foreground">{data.map((d, i) => <span key={i} className={cn("flex-1 text-center", i === sel && "font-semibold text-foreground")}>{d.label}</span>)}</div>
      <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-foreground" /> Faturado</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-primary/60 bg-[repeating-linear-gradient(45deg,var(--color-primary)_0_1px,transparent_1px_3px)] opacity-70" /> Custos (MO, transporte, materiais)</span>
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

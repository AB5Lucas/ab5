import { CountUp } from "@/components/count-up";

export function ResultProgressGauge({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const point = (v: number, r: number) => { const a = Math.PI * (1 - v / 100); return { x: 120 + r * Math.cos(a), y: 114 - r * Math.sin(a) }; };
  const tip = point(pct, 77);
  return <div className="relative mx-auto w-full max-w-72" role="img" aria-label={`Conclusão da obra: ${pct.toLocaleString("pt-BR")}%`}>
    <svg viewBox="0 0 240 145" className="w-full overflow-visible">
      {Array.from({ length: 51 }, (_, i) => {
        const a = point(i * 2, i % 5 ? 96 : 92), b = point(i * 2, 102);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={i * 2 <= pct ? "stroke-foreground" : "stroke-muted-foreground/35"} strokeWidth={i % 5 ? 1 : 2} />;
      })}
      {[0, 20, 40, 60, 80, 100].map((n) => { const p = point(n, 113); return <text key={n} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[8px]">{n}</text>; })}
      <path d="M 37 114 A 83 83 0 0 1 203 114" fill="none" className="stroke-muted" strokeWidth="9" strokeLinecap="round" />
      <path d="M 37 114 A 83 83 0 0 1 203 114" fill="none" className="ov-fade stroke-foreground" strokeWidth="9" strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} />
      <line x1="120" y1="114" x2={tip.x} y2={tip.y} className="stroke-foreground" strokeWidth="2" />
      <circle cx="120" cy="114" r="5" className="fill-foreground" />
    </svg>
    <p className="-mt-2 text-center font-display text-3xl font-semibold tabular-nums"><CountUp value={`${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`} /></p>
  </div>;
}
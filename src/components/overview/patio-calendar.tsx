/**
 * Pessoas no Pátio em calendário (Atividades): cada dia (ou mês) mostra quantas pessoas estavam no Pátio,
 * com o tom mais forte quanto mais gente; resumo ao lado com o total do período e a parte do efetivo.
 */
import { cn } from "@/lib/utils";

export type PatioDay = { key: string; label: string; title: string; value: number };

const WD = ["S", "T", "Q", "Q", "S", "S", "D"];

function tone(v: number, max: number) {
  if (!v) return "border border-dashed border-border text-muted-foreground";
  const r = v / Math.max(1, max);
  return r > 0.75 ? "bg-foreground text-background" : r > 0.5 ? "bg-foreground/70 text-background" : r > 0.25 ? "bg-foreground/40 text-foreground" : "bg-foreground/15 text-foreground";
}

export function PatioCalendar({ days, unit, total, workforce }: { days: PatioDay[]; unit: "day" | "month"; total: number; workforce: number }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const lead = unit === "day" && days[0] ? (new Date(`${days[0].key}T12:00:00`).getDay() + 6) % 7 : 0;
  const share = workforce ? total / workforce : 0;
  const withPeople = days.filter((d) => d.value > 0);
  const avg = withPeople.length ? Math.round(withPeople.reduce((a, d) => a + d.value, 0) / withPeople.length) : 0;
  const peak = withPeople.reduce<PatioDay | null>((a, d) => (!a || d.value > a.value ? d : a), null);
  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <div className="min-w-0 flex-1">
        <div className={cn("grid gap-1", unit === "day" ? "grid-cols-7" : "grid-cols-6")}>
          {unit === "day" && WD.map((w, i) => <span key={i} className="pb-0.5 text-center text-[10px] font-medium text-muted-foreground">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
          {days.map((d, i) => (
            <div key={d.key} title={`${d.title}: ${d.value} ${d.value === 1 ? "pessoa" : "pessoas"}`}
              className={cn("ov-grow mx-auto flex aspect-square w-full max-w-7 flex-col items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-transform hover:scale-110", tone(d.value, max))}
              style={{ animationDelay: `${i * 18}ms` }}>
              {d.value || d.label}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Menos</span>
          {["border border-dashed border-border", "bg-foreground/15", "bg-foreground/40", "bg-foreground/70", "bg-foreground"].map((c) => <span key={c} className={cn("h-2.5 w-2.5 rounded-full", c)} />)}
          <span>Mais</span>
          <span className="ml-auto">{unit === "day" ? "número = pessoas no dia" : "média por dia no mês"}</span>
        </div>
      </div>
      <SummaryPanel>
        <SummaryHead label={unit === "day" ? "No mês" : "No período"} value={total} sub="pessoas diferentes no Pátio" />
        <div>
          <div className="flex items-baseline justify-between text-xs"><span className="text-muted-foreground">Do efetivo</span><span className="font-semibold tabular-nums">{(share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground transition-[width] duration-700" style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
          <p className="mt-1 text-[10px] text-muted-foreground">{total} de {workforce} colaboradores ativos</p>
        </div>
        <SummaryRow label="Média por dia" value={avg} />
        <SummaryRow label="Pico" value={peak ? `${peak.value} · ${peak.title}` : "—"} />
      </SummaryPanel>
    </div>
  );
}

export function SummaryPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-3 border-t pt-3 md:w-52 md:border-l md:border-t-0 md:pl-5 md:pt-0">{children}</div>;
}
export function SummaryHead({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
export function SummaryRow({ label, value, dot, sub }: { label: string; value: React.ReactNode; dot?: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-xs transition-colors hover:bg-muted">
      {dot && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", dot)} />}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
      {sub && <span className="w-11 text-right text-[10px] tabular-nums text-muted-foreground">{sub}</span>}
    </div>
  );
}

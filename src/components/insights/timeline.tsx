/**
 * Linha do tempo em bolinhas (um dia por coluna): tamanho = quantidade, cor = urgência.
 * Usada no Radar de vencimentos; clicar no dia chama onPick.
 */
import { cn } from "@/lib/utils";

export type TimelineTone = "red" | "orange" | "green" | "gray";
export type TimelineDay = { date: string; count: number; tone: TimelineTone; title?: string };

const FILL: Record<TimelineTone, string> = {
  red: "fill-destructive",
  orange: "fill-warning",
  green: "fill-success",
  gray: "fill-muted-foreground/40",
};

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function Timeline({ days, selected, onPick, className }: {
  days: TimelineDay[]; selected?: string | null; onPick?: (date: string) => void; className?: string;
}) {
  const col = 10;
  const h = 26;
  const max = Math.max(1, ...days.map((d) => d.count));
  const width = Math.max(col, days.length * col);
  return (
    <div className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Linha do tempo">
        <line x1={0} x2={width} y1={h / 2} y2={h / 2} className="stroke-border" strokeWidth={0.6} />
        {days.map((d, i) => {
          const cx = i * col + col / 2;
          const weekday = new Date(`${d.date}T12:00:00Z`).getUTCDay();
          return (
            <g key={d.date}>
              {weekday === 1 && <line x1={i * col} x2={i * col} y1={h / 2 - 3} y2={h / 2 + 3} className="stroke-border" strokeWidth={0.6} />}
              {d.count > 0 && (
                <circle cx={cx} cy={h / 2} r={1.6 + 3.4 * Math.sqrt(d.count / max)}
                  className={cn(FILL[d.tone], onPick && "cursor-pointer hover:opacity-75", selected === d.date && "stroke-foreground")}
                  strokeWidth={selected === d.date ? 1 : 0}
                  onClick={(e) => { if (!onPick) return; e.stopPropagation(); onPick(d.date); }}>
                  <title>{d.title ?? `${br(d.date)}: ${d.count}`}</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      {days.length > 0 && (
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{br(days[0]!.date)}</span>
          <span>{br(days[Math.floor(days.length / 2)]!.date)}</span>
          <span>{br(days[days.length - 1]!.date)}</span>
        </div>
      )}
    </div>
  );
}

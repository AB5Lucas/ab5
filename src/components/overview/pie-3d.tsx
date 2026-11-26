import { useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/count-up";
import { cn } from "@/lib/utils";

export type PiePart = { key: string; label: string; n: number; names: string[] };
const PIE_TONES = [1, 0.65, 0.4, 0.2];
/** Fatia da pizza (ângulos em voltas, 0 = topo). */
/** Pizza 3D: elipse inclinada (RX × RY) com espessura DEPTH desenhada em camadas mais escuras por baixo. */
const RX = 48, RY = 30, CY = 34, DEPTH = 12;
function slicePath(a0: number, a1: number, dy = 0) {
  const p = (t: number) => `${(50 + RX * Math.sin(2 * Math.PI * t)).toFixed(2)} ${(CY + dy - RY * Math.cos(2 * Math.PI * t)).toFixed(2)}`;
  const mid = (a0 + a1) / 2; // dois arcos: cobre também a pizza inteira (uma só situação)
  return `M50 ${CY + dy} L${p(a0)} A${RX} ${RY} 0 0 1 ${p(mid)} A${RX} ${RY} 0 0 1 ${p(a1)} Z`;
}
/** Cor da fatia (tom do texto sobre o fundo do quadro) e da lateral (mais escura). */
const toneFill = (tone: number, side = false) =>
  side ? `color-mix(in oklab, color-mix(in oklab, var(--foreground) ${Math.round(tone * 100)}%, var(--card)) 72%, black)`
    : `color-mix(in oklab, var(--foreground) ${Math.round(tone * 100)}%, var(--card))`;

/**
 * Pizza 3D com lista por fatia (Planejamento: veículos; guardada para o dashboard de Funcionários: ausências).
 * Clicar numa fatia: a pizza encolhe para o canto, as outras fatias somem e a lista entra; clicar de novo na fatia
 * (pizza pequena) faz o caminho inverso.
 */
export function Pie3D({ total, totalLabel, parts, unit = ["pessoa", "pessoas"], badge, compact }: {
  total: number; totalLabel: string; parts: PiePart[];
  /** Singular e plural do que está na lista. */
  unit?: [string, string];
  /** Texto do círculo de cada linha (padrão: iniciais). */
  badge?: (name: string) => string;
  /** Sem altura mínima (quadro baixo). */
  compact?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Entrada: as fatias chegam de fora, uma a uma, e se encaixam no lugar.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 80);
    return () => window.clearTimeout(t);
  }, []);
  // Depois da entrada, o realce do mouse fica sem atraso.
  const [hoverReady, setHoverReady] = useState(false);
  useEffect(() => {
    if (!entered) return;
    const t = window.setTimeout(() => setHoverReady(true), 1400);
    return () => window.clearTimeout(t);
  }, [entered]);
  const sum = parts.reduce((a, p) => a + p.n, 0);
  const cur = parts.find((p) => p.key === sel) ?? null;
  // Mantém o conteúdo da última fatia enquanto a lista sai (animação de volta).
  const lastRef = useRef<PiePart | null>(null);
  if (cur) lastRef.current = cur;
  const view = cur ?? lastRef.current;
  let acc = 0;
  const slices = parts.filter((p) => p.n > 0).map((p) => {
    const i = parts.indexOf(p);
    const a0 = acc / sum; acc += p.n; const a1 = acc / sum;
    return { ...p, i, a0, a1, mid: (a0 + a1) / 2 };
  });
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div className={cn("relative flex-1 overflow-hidden", compact ? "min-h-[10rem]" : "min-h-[14rem]")} onClick={stop}>
      {/* Pizza: no centro com a legenda; com fatia escolhida, encolhe para o canto de cima. */}
      <div className={cn("absolute flex items-center gap-4 transition-all duration-700 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
        "left-0 top-0", cur ? "h-16 w-16" : "h-full w-full")}>
        <div className={cn("relative aspect-[100/82] shrink-0 transition-all duration-700", cur ? "h-14 max-w-16 cursor-pointer" : compact ? "h-[80%] max-w-[50%]" : "h-full max-w-[60%]")}
          title={cur ? "Clique para voltar à pizza" : undefined} onClick={cur ? (e) => { stop(e); setSel(null); } : undefined}>
          {!sum ? (
            <div className="flex h-full items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">Ninguém fora</div>
          ) : (
            <svg viewBox="0 0 100 82" className="h-full w-full overflow-visible">
              {/* 1º as laterais de todas as fatias (de trás para a frente), depois os topos: assim nenhuma lateral cobre o topo de outra. */}
              {(["side", "top"] as const).map((layer) => slices.map((sl) => {
                const out = !entered ? 34 : (hover === sl.key && !cur) ? 4 : 0;
                const dx = out * Math.sin(2 * Math.PI * sl.mid), dy = -out * 0.62 * Math.cos(2 * Math.PI * sl.mid);
                const hidden = cur && cur.key !== sl.key;
                const tone = PIE_TONES[sl.i]!;
                return (
                  <g key={`${layer}-${sl.key}`} style={{
                    transform: `translate(${dx}px, ${dy}px)`, opacity: hidden || !entered ? 0 : 1,
                    transition: !entered ? "none" : hoverReady ? "transform 300ms, opacity 500ms"
                      : `transform 750ms cubic-bezier(0.34, 1.4, 0.64, 1) ${120 + slices.indexOf(sl) * 140}ms, opacity 450ms ${120 + slices.indexOf(sl) * 140}ms`,
                  }}>
                    {layer === "side"
                      ? Array.from({ length: DEPTH }, (_, k) => DEPTH - k).map((k) => <path key={k} d={slicePath(sl.a0, sl.a1, k)} style={{ fill: toneFill(tone, true) }} />)
                      : <>
                        <path d={slicePath(sl.a0, sl.a1)} style={{ fill: toneFill(tone) }} className="stroke-card" strokeWidth="0.6" />
                        <title>{`${sl.label}: ${sl.n}`}</title>
                        {!cur && <path d={slicePath(sl.a0, sl.a1)} fill="transparent" className="cursor-pointer"
                          onMouseEnter={() => setHover(sl.key)} onMouseLeave={() => setHover(null)} onClick={(e) => { stop(e); setHover(null); setSel(sl.key); }} />}
                      </>}
                  </g>
                );
              }))}
            </svg>
          )}
        </div>
        <div className={cn("min-w-0 space-y-2 transition-opacity duration-300", cur ? "pointer-events-none opacity-0" : "opacity-100 delay-300")}>
          <div><span className="font-display text-3xl font-semibold tabular-nums"><CountUp value={total} /></span><p className="text-xs text-muted-foreground">{totalLabel}</p></div>
          {parts.map((p, i) => (
            <button key={p.key} type="button" disabled={!p.n} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}
              onClick={(e) => { stop(e); setHover(null); setSel(p.key); }}
              className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-muted disabled:opacity-50">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-foreground" style={{ opacity: PIE_TONES[i] }} />
              <span className="flex-1">{p.label}</span><b className="tabular-nums">{p.n}</b>
            </button>
          ))}
          <p className="text-[10px] text-muted-foreground">Clique numa fatia para ver a lista.</p>
        </div>
      </div>
      {/* Pessoas da fatia escolhida. */}
      <div className={cn("absolute inset-0 flex flex-col transition-all duration-700 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
        cur ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0")}>
        <div className="flex h-16 items-center gap-3 pl-20">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{view?.label}</p>
            <p className="text-xs text-muted-foreground">{view?.n} {view?.n === 1 ? unit[0] : unit[1]}{sum ? ` · ${Math.round(((view?.n ?? 0) / sum) * 100)}%` : ""} · clique na fatia para voltar</p>
          </div>
        </div>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-xs">
          {(view?.names ?? []).map((n, i) => (
            <li key={`${n}-${i}`} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1"
              style={{ transition: "opacity 400ms, transform 400ms", transitionDelay: cur ? `${200 + Math.min(i, 20) * 25}ms` : "0ms", opacity: cur ? 1 : 0, transform: cur ? "none" : "translateY(6px)" }}>
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-semibold">{badge ? badge(n) : n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("")}</span>
              <span className="truncate">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

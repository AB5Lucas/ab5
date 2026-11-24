/**
 * Mapa animado (Atividades): o contorno é desenhado, o mapa se inclina em 3D e os clientes surgem em sequência.
 * Modo opcional; o mapa clássico (Leaflet) continua disponível pelo seletor em clients-map.tsx.
 */
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { STATES } from "./geo-shapes";
import type { MapClient } from "./clients-map";

/** Ponto dentro do contorno do estado (ray casting nos anéis do desenho). */
export function inState(uf: string, lon: number, lat: number) {
  let inside = false;
  for (const r of STATES[uf] ?? []) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i]![0]!, yi = r[i]![1]!, xj = r[j]![0]!, yj = r[j]![1]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function AnimatedMap({ clients, region, className }: { clients: MapClient[]; region: "SP" | "BR"; className?: string }) {
  const [run, setRun] = useState(0);
  const [hover, setHover] = useState<MapClient | null>(null);
  const W = 1000, H = region === "SP" ? 640 : 1000;

  const { paths, project } = useMemo(() => {
    const keys = region === "SP" ? ["SP"] : Object.keys(STATES);
    const rings = keys.flatMap((k) => STATES[k] ?? []);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { const x = p[0]!, y = p[1]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const s = Math.min((W * 0.9) / ((x1 - x0) * k), (H * 0.9) / (y1 - y0));
    const ox = (W - (x1 - x0) * k * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    const project = (lon: number, lat: number): [number, number] => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s];
    const paths = keys.map((key) => ({
      key,
      d: (STATES[key] ?? []).map((r) => "M" + r.map((p) => project(p[0]!, p[1]!).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(""),
    }));
    return { paths, project };
  }, [region, H]);

  const max = Math.max(1, ...clients.map((c) => c.billed ?? 0));
  const pts = clients.map((c) => ({ c, xy: project(c.lon, c.lat), r: (region === "SP" ? 7 : 5) + Math.sqrt((c.billed ?? 0) / max) * (region === "SP" ? 14 : 10) }))
    .filter((p) => p.xy[0] > -50 && p.xy[0] < W + 50 && p.xy[1] > -50 && p.xy[1] < H + 50)
    .sort((a, b) => a.xy[0] - b.xy[0]);

  return (
    <div className={`relative overflow-hidden bg-card text-foreground ${className ?? ""}`} style={{ perspective: "1400px" }}>
      <div key={run} className="amap-stage h-full w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {paths.map((p, i) => (
            <path key={p.key} d={p.d} pathLength={1} className="amap-line"
              style={{ animationDelay: `${region === "BR" ? i * 40 : 0}ms` }} />
          ))}
          {pts.map((p, i) => (
            <g key={p.c.id} className="amap-pin" style={{ animationDelay: `${2600 + i * 70}ms` }}
              onMouseEnter={() => setHover(p.c)} onMouseLeave={() => setHover(null)}>
              <circle cx={p.xy[0]} cy={p.xy[1]} r={p.r} className="fill-foreground stroke-background" strokeWidth={2.5} fillOpacity={0.85} />
            </g>
          ))}
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm">
          <div className="font-semibold">{hover.name}</div>
          {hover.city && <div className="text-muted-foreground">{hover.city}</div>}
          {!!hover.billed && <div>Faturado: {brl(hover.billed)}</div>}
          {hover.marginPct != null && <div>Margem: {hover.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div>}
        </div>
      )}
      <button type="button" onClick={() => setRun((n) => n + 1)} title="Rever animação"
        className="absolute bottom-3 right-3 z-10 rounded-full border bg-background/90 p-1.5 shadow-sm hover:bg-background">
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

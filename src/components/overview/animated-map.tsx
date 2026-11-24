/**
 * Mapa animado (Atividades): o contorno é desenhado, o mapa se inclina em 3D e os clientes surgem em sequência.
 * SP mostra também o contorno das cidades (IBGE, public/geo/sp-cities.json). Roda do mouse / botões = zoom; arrastar = mover.
 * Desenho próprio, sem API de mapas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
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
let citiesCache: Promise<number[][][]> | null = null;
const loadCities = () => (citiesCache ??= fetch("/geo/sp-cities.json").then((r) => r.json()).catch(() => []));

export function AnimatedMap({ clients, region, className }: { clients: MapClient[]; region: "SP" | "BR"; className?: string }) {
  const [run, setRun] = useState(0);
  const [hover, setHover] = useState<MapClient | null>(null);
  const [cities, setCities] = useState<number[][][]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(region === "SP" ? 0.62 : 0.9);
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e!.contentRect; if (r.width > 0 && r.height > 0) setRatio(r.height / r.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const W = 1000, H = Math.round(W * ratio);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); }, [region, run]);
  useEffect(() => { if (region === "SP") void loadCities().then(setCities); }, [region]);

  const { paths, project } = useMemo(() => {
    const keys = region === "SP" ? ["SP"] : Object.keys(STATES);
    const rings = keys.flatMap((k) => STATES[k] ?? []);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { const x = p[0]!, y = p[1]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const s = Math.min((W * 0.99) / ((x1 - x0) * k), (H * 0.92) / (y1 - y0));
    const ox = (W - (x1 - x0) * k * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    const project = (lon: number, lat: number): [number, number] => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s];
    const ring = (r: number[][]) => "M" + r.map((p) => project(p[0]!, p[1]!).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
    const paths = keys.map((key) => ({ key, d: (STATES[key] ?? []).map(ring).join("") }));
    return { paths, project, ring };
  }, [region, H]);
  const cityPath = useMemo(() => {
    if (region !== "SP" || !cities.length) return "";
    return cities.map((r) => "M" + r.map((p) => project(p[0]!, p[1]!).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");
  }, [cities, project, region]);

  const max = Math.max(1, ...clients.map((c) => c.billed ?? 0));
  const pts = clients.map((c) => ({ c, xy: project(c.lon, c.lat), r: (region === "SP" ? 8 : 6) + Math.sqrt((c.billed ?? 0) / max) * (region === "SP" ? 14 : 10) }))
    .filter((p) => p.xy[0] > -50 && p.xy[0] < W + 50 && p.xy[1] > -50 && p.xy[1] < H + 50)
    .sort((a, b) => b.r - a.r); // menores por cima, mais fáceis de pegar

  const zoom = (f: number, cx = W / 2, cy = H / 2) => setView((v) => {
    const k = Math.min(12, Math.max(1, v.k * f));
    const vw = W / k, vh = H / k;
    const px = v.x + (cx / W) * (W / v.k), py = v.y + (cy / H) * (H / v.k);
    const x = Math.min(W - vw, Math.max(0, px - (cx / W) * vw)), y = Math.min(H - vh, Math.max(0, py - (cy / H) * vh));
    return { x, y, k };
  });
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
  };
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const [x, y] = toSvg(e); zoom(e.deltaY < 0 ? 1.3 : 1 / 1.3, x, y); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const inv = 1 / view.k;
  const btn = "flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background";
  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-card text-foreground ${className ?? ""}`} style={{ perspective: "1400px" }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div key={`${region}-${run}`} className="amap-stage h-full w-full">
        <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`} className="h-full w-full cursor-grab touch-none active:cursor-grabbing" preserveAspectRatio="xMidYMid meet"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d || view.k === 1) return;
            const r = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.x) / r.width) * (W / view.k), dy = ((e.clientY - d.y) / r.height) * (H / view.k);
            setView((v) => ({ ...v, x: Math.min(W - W / v.k, Math.max(0, d.vx - dx)), y: Math.min(H - H / v.k, Math.max(0, d.vy - dy)) }));
          }}
          onPointerUp={() => { drag.current = null; }}>
          {paths.map((p, i) => (
            <path key={p.key} d={p.d} pathLength={1} className="amap-line" style={{ animationDelay: `${region === "BR" ? i * 40 : 0}ms` }} />
          ))}
          {cityPath && <path d={cityPath} className="amap-cities" strokeWidth={0.6 * inv} />}
          {pts.map((p, i) => (
            <g key={p.c.id} className="amap-pin" style={{ animationDelay: `${2600 + i * 60}ms` }}
              onMouseEnter={() => setHover(p.c)} onMouseLeave={() => setHover(null)}>
              <circle cx={p.xy[0]} cy={p.xy[1]} r={(p.r + 10) * inv} fill="transparent" />
              <circle cx={p.xy[0]} cy={p.xy[1]} r={p.r * inv} className={hover?.id === p.c.id ? "fill-primary stroke-background" : "fill-foreground stroke-background"} strokeWidth={2.5 * inv} fillOpacity={0.88} />
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
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
        <button type="button" className={btn} title="Aproximar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoom(1.5); }}><Plus className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} title="Afastar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoom(1 / 1.5); }}><Minus className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} title="Rever animação" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRun((n) => n + 1); }}><RotateCcw className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

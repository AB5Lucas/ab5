import type React from "react";
/**
 * Mapa animado (Atividades): o contorno é desenhado, o mapa se inclina em 3D e os clientes surgem em sequência.
 * Contorno das cidades por UF (IBGE via geodata-br, public/geo/<uf>-cities.json): SP sempre; outra UF ao escolher um cliente dela. Roda do mouse / botões = zoom; arrastar = mover.
 * Desenho próprio, sem API de mapas.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
const citiesCache = new Map<string, Promise<number[][][]>>();
/** Contorno das cidades de uma UF (public/geo/<uf>-cities.json), carregado sob demanda. */
const loadCities = (uf: string) => {
  const k = uf.toLowerCase();
  if (!citiesCache.has(k)) citiesCache.set(k, fetch(`/geo/${k}-cities.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return citiesCache.get(k)!;
};
/** UF do ponto pelo contorno dos estados. */
export function ufOf(lon: number, lat: number) { return Object.keys(STATES).find((uf) => inState(uf, lon, lat)) ?? null; }

/** Tempo da troca de região (Brasil ↔ estado), em ms; o Brasil espera REGION_WAIT antes de afastar. */
export const REGION_MS = 1900;
export const REGION_WAIT = 350;
/** Tempo para o Brasil desenhar a silhueta de todos os estados antes de entrar em outro estado (clients-map). */
export const BR_DRAW_MS = 2900;

export function AnimatedMap({ clients, region, className, extra, focus, selected, onPick }: { onPick?: (c: MapClient) => void; clients: MapClient[]; region: string; /** "BR" ou a UF */ className?: string; extra?: React.ReactNode; focus?: { lon: number; lat: number; n: number; uf?: string | null } | null; selected?: string | null }) {
  const [run, setRun] = useState(0);
  // Inclinação 3D só no mapa inteiro: com zoom o mapa fica plano (o navegador desenha a camada inclinada em baixa resolução).
  const [tilted, setTilted] = useState(false);
  useEffect(() => { setTilted(false); }, [run]);
  const [hover, setHover] = useState<MapClient | null>(null);
  const [citiesBy, setCitiesBy] = useState<Record<string, number[][][]>>({});
  const boxRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(region !== "BR" ? 0.62 : 0.9);
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e!.contentRect; if (r.width > 0 && r.height > 0) setRatio(r.height / r.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const W = 1000, H = Math.round(W * ratio);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Animação da câmera (viewBox): zoom, foco e troca SP ↔ Brasil.
  const anim = useRef<number | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  // Durante o movimento da câmera os contornos das cidades ficam escondidos (são milhares de linhas: redesenhar a cada quadro travava).
  const [moving, setMoving] = useState(false);
  const animateTo = (t: { x: number; y: number; k: number }, ms = 800, smooth = false) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    setMoving(true);
    const f = viewRef.current, t0 = performance.now();
    // smooth: começa e termina devagar (troca de região); padrão: só desacelera no fim.
    const ease = smooth ? (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2) : (u: number) => 1 - Math.pow(1 - u, 3);
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms), e = ease(u);
      const k = Math.exp(Math.log(f.k) + (Math.log(t.k) - Math.log(f.k)) * e);
      // interpola o centro para o movimento ficar natural
      const fc = [f.x + W / f.k / 2, f.y + H / f.k / 2], tc = [t.x + W / t.k / 2, t.y + H / t.k / 2];
      // O centro anda junto com a escala (proporcional a 1/k): o ponto de destino (ex.: o cliente) vem chegando
      // e nunca sai da tela no meio do zoom; sem mudança de escala, anda linear.
      const dk = 1 / t.k - 1 / f.k, w = Math.abs(dk) > 1e-9 ? (1 / k - 1 / f.k) / dk : e;
      const cx = fc[0]! + (tc[0]! - fc[0]!) * w, cy = fc[1]! + (tc[1]! - fc[1]!) * w;
      setView({ k, x: cx - W / k / 2, y: cy - H / k / 2 });
      anim.current = u < 1 ? requestAnimationFrame(step) : null;
      if (u >= 1) setMoving(false);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);
  const prevRegion = useRef(region);
  const regionChangedAt = useRef(0);
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); }, [run]);
  const showUfs = useMemo(() => {
    const set = new Set<string>();
    if (region !== "BR") set.add(region);
    
    return [...set];
  }, [region, view.k >= 2, focus?.uf]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const uf of showUfs) if (!citiesBy[uf]) void loadCities(uf).then((rings) => setCitiesBy((m) => ({ ...m, [uf]: rings })));
  }, [showUfs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entrando num estado vindo do Brasil: os outros estados continuam desenhados durante o zoom (ghost "on"),
  // somem devagar quando o zoom termina ("fading") e só então saem da tela ("off").
  const [ghost, setGhost] = useState<"on" | "fading" | "off">("off");
  // No 1º desenho com o estado novo o efeito ainda não rodou: prevRegion ainda é "BR", então os vizinhos já ficam
  // (sem isso eles saíam e voltavam, recomeçando a animação de desenho).
  const keepAll = region !== "BR" && (ghost !== "off" || prevRegion.current === "BR");
  const { paths, project, unproject } = useMemo(() => {
    const keys = region !== "BR" ? [region] : Object.keys(STATES);
    const drawKeys = keepAll ? Object.keys(STATES) : keys;
    const rings = keys.flatMap((k) => STATES[k] ?? []);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { const x = p[0]!, y = p[1]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // Mesmo fator de latitude para Brasil e estados: o desenho muda só de escala/posição entre regiões,
    // então a troca de projeção no meio da animação não dá "tranco" (com o fator de cada região a forma esticava ~5%).
    const k = Math.cos((15 * Math.PI) / 180);
    const s = Math.min((W * 0.99) / ((x1 - x0) * k), (H * 0.92) / (y1 - y0));
    const ox = (W - (x1 - x0) * k * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    const project = (lon: number, lat: number): [number, number] => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s];
    const unproject = (x: number, y: number): [number, number] => [x0 + (x - ox) / (k * s), y1 - (y - oy) / s];
    const ring = (r: number[][]) => "M" + r.map((p) => project(p[0]!, p[1]!).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
    const paths = drawKeys.map((key) => ({ key, d: (STATES[key] ?? []).map(ring).join("") }));
    return { paths, project, unproject, ring };
  }, [region, H, keepAll]); // eslint-disable-line react-hooks/exhaustive-deps
  const fitBox = (uf: string[]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const key of uf) for (const rg of STATES[key] ?? []) for (const pt of rg) { const [x, y] = project(pt[0]!, pt[1]!); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.95;
    return { k, x: (x0 + x1) / 2 - W / k / 2, y: (y0 + y1) / 2 - H / k / 2 };
  };
  // Câmera no cliente escolhido (mais perto no estado, um pouco menos no Brasil).
  const focusView = (f: { lon: number; lat: number }) => {
    const [fx, fy] = project(f.lon, f.lat);
    const k = region !== "BR" ? 5 : 8, vw = W / k, vh = H / k;
    return { k, x: Math.min(W - vw, Math.max(0, fx - vw / 2)), y: Math.min(H - vh, Math.max(0, fy - vh / 2)) };
  };
  // Projeção do último desenho: na troca de região a câmera parte exatamente do que estava na tela (sem salto).
  const projRef = useRef<{ unproject: (x: number, y: number) => [number, number] } | null>(null);
  const focusDone = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (prevRegion.current === region) return;
    const prev = prevRegion.current; prevRegion.current = region; regionChangedAt.current = performance.now();
    if (anim.current) cancelAnimationFrame(anim.current);
    // Ponto de partida = o enquadramento atual (ex.: zoom num cliente) levado para a projeção nova.
    const old = projRef.current, v = viewRef.current;
    let from = fitBox(region === "BR" ? [prev] : Object.keys(STATES));
    if (old) {
      const [lonA, latA] = old.unproject(v.x, v.y), [lonB, latB] = old.unproject(v.x + W / v.k, v.y + H / v.k);
      const [ax, ay] = project(lonA, latA), [bx, by] = project(lonB, latB);
      const k = Math.max(0.02, Math.min(W / Math.max(1e-6, bx - ax), H / Math.max(1e-6, by - ay)));
      from = { k, x: (ax + bx) / 2 - W / k / 2, y: (ay + by) / 2 - H / k / 2 };
    }
    viewRef.current = from; setView(from); setMoving(true);
    // Destino: o cliente escolhido (entrada direta, um movimento só) ou a região inteira.
    const toFocus = focus && region !== "BR" ? focusView(focus) : null;
    if (toFocus && focus) focusDone.current = focus.n;
    // Indo para o Brasil, espera as silhuetas dos estados começarem a aparecer; os movimentos começam e terminam devagar.
    const wait = region === "BR" ? REGION_WAIT : 0;
    const ms = toFocus ? REGION_MS + 500 : REGION_MS;
    const t = window.setTimeout(() => animateTo(toFocus ?? { x: 0, y: 0, k: 1 }, ms, true), wait);
    const fromBR = prev === "BR" && region !== "BR";
    setGhost(fromBR ? "on" : "off");
    const t2 = fromBR ? window.setTimeout(() => setGhost("fading"), ms) : 0;
    const t3 = fromBR ? window.setTimeout(() => setGhost("off"), ms + 700) : 0;
    return () => { window.clearTimeout(t); window.clearTimeout(t2); window.clearTimeout(t3); };
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { projRef.current = { unproject }; }, [unproject]);
  // Cidades (milhares de contornos) só são montadas com a câmera parada: montar no início do zoom travava a animação.
  const cityPath = useMemo(() => {
    if (moving) return "";
    const cities = showUfs.flatMap((uf) => (region !== "BR" && uf !== region ? [] : citiesBy[uf] ?? []));
    if (!cities.length) return "";
    return cities.map((r) => "M" + r.map((p) => project(p[0]!, p[1]!).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");
  }, [citiesBy, showUfs, project, region, moving]);

  const max = Math.max(1, ...clients.map((c) => c.billed ?? 0));
  const pts = clients.map((c) => ({ c, xy: project(c.lon, c.lat), r: (region !== "BR" ? 3 : 2.2) + Math.sqrt((c.billed ?? 0) / max) * (region !== "BR" ? 5.5 : 4) }))
    .filter((p) => p.xy[0] > -50 && p.xy[0] < W + 50 && p.xy[1] > -50 && p.xy[1] < H + 50)
    .sort((a, b) => b.r - a.r); // menores por cima, mais fáceis de pegar

  const zoomTarget = (v: { x: number; y: number; k: number }, f: number, cx = W / 2, cy = H / 2) => {
    const k = Math.min(12, Math.max(1, v.k * f));
    const vw = W / k, vh = H / k;
    const px = v.x + (cx / W) * (W / v.k), py = v.y + (cy / H) * (H / v.k);
    const x = Math.min(W - vw, Math.max(0, px - (cx / W) * vw)), y = Math.min(H - vh, Math.max(0, py - (cy / H) * vh));
    return { x, y, k };
  };
  const zoom = (f: number, cx = W / 2, cy = H / 2) => setView((v) => zoomTarget(v, f, cx, cy));
  const zoomAnim = (f: number) => animateTo(zoomTarget(viewRef.current, f), 450);
  // Cliente escolhido / tirado na mesma região. Quando a região também muda, o efeito da região já faz o movimento
  // (um só, sem dois zooms brigando); aqui só espera o que falta dele.
  useEffect(() => {
    const sinceRegion = performance.now() - regionChangedAt.current;
    if (!focus) { if (sinceRegion > 100 && viewRef.current.k > 1) animateTo({ x: 0, y: 0, k: 1 }, 1400, true); return; }
    if (focusDone.current === focus.n) return;
    focusDone.current = focus.n;
    const wait = Math.max(0, REGION_WAIT + REGION_MS + 50 - sinceRegion);
    const t = setTimeout(() => animateTo(focusView(focus), 1400, true), wait);
    return () => clearTimeout(t);
  }, [focus?.n ?? 0]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <div ref={boxRef} className={`relative overflow-hidden text-foreground ${className ?? ""}`} style={{ perspective: "1400px" }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div key={run} className={`amap-stage h-full w-full ${tilted ? "amap-done" : ""} ${view.k > 1.15 ? "amap-flat" : ""}`}
        onAnimationEnd={(e) => { if (e.animationName === "amap-tilt") setTilted(true); }}>
        <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`} shapeRendering="geometricPrecision" className={`h-full w-full cursor-grab touch-none active:cursor-grabbing ${moving ? "amap-moving" : ""}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={(e) => { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; } (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d || view.k === 1) return;
            const r = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.x) / r.width) * (W / view.k), dy = ((e.clientY - d.y) / r.height) * (H / view.k);
            setView((v) => ({ ...v, x: Math.min(W - W / v.k, Math.max(0, d.vx - dx)), y: Math.min(H - H / v.k, Math.max(0, d.vy - dy)) }));
          }}
          onPointerUp={() => { drag.current = null; }}>
          {paths.map((p, i) => (
            <path key={p.key} d={p.d} pathLength={1} className={`amap-line ${region !== "BR" && p.key !== region ? `amap-ghost ${ghost === "fading" ? "amap-gone" : ""}` : ""}`} style={{ animationDelay: `${region === "BR" ? i * 40 : 0}ms` }} />
          ))}
          {cityPath && <path d={cityPath} className="amap-cities" strokeWidth={view.k > 2 ? 1 : 0.7} style={{ vectorEffect: "non-scaling-stroke", strokeOpacity: view.k > 2 ? 0.55 : undefined }} />}
          {pts.map((p, i) => (
            <g key={p.c.id} className="amap-pin"
              onMouseEnter={() => setHover(p.c)} onMouseLeave={() => setHover(null)}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick?.(p.c); }} style={{ animationDelay: `${(regionChangedAt.current ? REGION_WAIT + REGION_MS : 2600) + i * 40}ms`, cursor: onPick ? "pointer" : undefined }}>
              <circle cx={p.xy[0]} cy={p.xy[1]} r={(p.r + 10) * inv} fill="transparent" />
              <circle cx={p.xy[0]} cy={p.xy[1]} r={p.r * inv} className={hover?.id === p.c.id || selected === p.c.id ? "fill-primary stroke-background" : "fill-foreground stroke-background"} strokeWidth={1 * inv} fillOpacity={0.88} />
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
        {extra}
        <button type="button" className={btn} title="Aproximar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoomAnim(1.5); }}><Plus className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} title="Afastar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoomAnim(1 / 1.5); }}><Minus className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} title="Rever animação" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRun((n) => n + 1); }}><RotateCcw className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

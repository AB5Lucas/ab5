/**
 * Mosaico da equipe (dashboard de Funcionários): um círculo por colaborador ativo, com a cor da situação no dia
 * (em obra, Pátio, treinamento/ASO/integração, ausente, sem escala). Os círculos são posicionados à mão (absolute +
 * translate) para que, ao trocar o agrupamento (Situação / Cliente / Função / Contrato), cada pessoa deslize até o
 * novo grupo. Ao entrar, os círculos saem do centro e se espalham em onda. Clicar num grupo destaca só ele.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TeamStatus = "obra" | "patio" | "doc" | "ausente" | "sem";
export type TeamPerson = { id: string; name: string; status: TeamStatus; place: string; detail: string; fn: string; contract: string };
export const STATUS_META: Record<TeamStatus, { label: string; dot: string; text: string }> = {
  obra: { label: "Em obra", dot: "bg-foreground", text: "text-background" },
  patio: { label: "Pátio", dot: "bg-foreground/55", text: "text-background" },
  doc: { label: "Treinamento / ASO / Integração", dot: "bg-card ring-[2.5px] ring-inset ring-foreground", text: "text-foreground" },
  ausente: { label: "Ausente", dot: "bg-foreground/15", text: "text-foreground/70" },
  sem: { label: "Sem escala", dot: "border border-dashed border-foreground/35 bg-transparent", text: "text-foreground/50" },
};
const STATUS_ORDER: TeamStatus[] = ["obra", "patio", "doc", "ausente", "sem"];
type Mode = "status" | "place" | "fn" | "contract";
const MODES: { key: Mode; label: string }[] = [
  { key: "status", label: "Situação" }, { key: "place", label: "Cliente" }, { key: "fn", label: "Função" }, { key: "contract", label: "Contrato" },
];
const MAX_GROUPS = 10;
const HEAD = 18, COL_GAP = 22, BLOCK_GAP = 10;

const initials = (n: string) => { const p = n.trim().split(/\s+/); return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase(); };

type Group = { key: string; label: string; ids: string[] };
function groupsOf(people: TeamPerson[], mode: Mode): Group[] {
  if (mode === "status") {
    return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, ids: people.filter((p) => p.status === s).map((p) => p.id) })).filter((g) => g.ids.length);
  }
  const by = new Map<string, string[]>();
  for (const p of people) {
    const k = mode === "place" ? p.place : mode === "fn" ? p.fn : p.contract;
    by.set(k, [...(by.get(k) ?? []), p.id]);
  }
  let list = [...by.entries()].map(([k, ids]) => ({ key: k, label: k, ids })).sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label, "pt-BR"));
  if (list.length > MAX_GROUPS) {
    const rest = list.slice(MAX_GROUPS - 1);
    list = [...list.slice(0, MAX_GROUPS - 1), { key: "__outros", label: `Outros (${rest.length})`, ids: rest.flatMap((g) => g.ids) }];
  }
  // Dentro do grupo, ordena pela situação (as cores ficam juntas).
  const rank = new Map(people.map((p) => [p.id, STATUS_ORDER.indexOf(p.status)]));
  const name = new Map(people.map((p) => [p.id, p.name]));
  for (const g of list) g.ids.sort((a, b) => rank.get(a)! - rank.get(b)! || name.get(a)!.localeCompare(name.get(b)!, "pt-BR"));
  return list;
}

type Layout = { size: number; pos: Map<string, { x: number; y: number }>; heads: { key: string; label: string; n: number; x: number; y: number; w: number }[] };
/** Maior círculo que cabe: grupos em blocos distribuídos em k colunas (o bloco vai para a coluna mais baixa). */
function layoutOf(groups: Group[], W: number, H: number): Layout {
  let best: Layout | null = null;
  for (let size = 34; size >= 7; size--) {
    const gap = Math.max(2, Math.round(size * 0.2));
    for (let k = 1; k <= 4; k++) {
      const cw = (W - (k - 1) * COL_GAP) / k;
      const per = Math.floor((cw + gap) / (size + gap));
      if (per < 1) continue;
      const colsH = Array(k).fill(0) as number[];
      const pos = new Map<string, { x: number; y: number }>();
      const heads: Layout["heads"] = [];
      for (const g of groups) {
        const c = colsH.indexOf(Math.min(...colsH));
        const x0 = c * (cw + COL_GAP), y0 = colsH[c]!;
        heads.push({ key: g.key, label: g.label, n: g.ids.length, x: x0, y: y0, w: cw });
        g.ids.forEach((id, i) => pos.set(id, { x: x0 + (i % per) * (size + gap), y: y0 + HEAD + Math.floor(i / per) * (size + gap) }));
        colsH[c] = y0 + HEAD + Math.ceil(g.ids.length / per) * (size + gap) - gap + BLOCK_GAP;
      }
      if (Math.max(...colsH) - BLOCK_GAP <= H) { best = { size, pos, heads }; break; }
    }
    if (best) break;
  }
  return best ?? { size: 7, pos: new Map(), heads: [] };
}

export function TeamMosaic({ people, title }: { people: TeamPerson[]; title: string }) {
  const [mode, setMode] = useState<Mode>("status");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.floor(e!.contentRect.width), h: Math.floor(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Entrada: um quadro com tudo no centro, depois os círculos se espalham.
  useEffect(() => { if (!box.w) return; const t = setTimeout(() => setReady(true), 60); return () => clearTimeout(t); }, [box.w]);
  const groups = useMemo(() => groupsOf(people, mode), [people, mode]);
  const L = useMemo(() => (box.w && box.h ? layoutOf(groups, box.w, box.h) : null), [groups, box.w, box.h]);
  const groupOf = useMemo(() => { const m = new Map<string, string>(); for (const g of groups) for (const id of g.ids) m.set(id, g.key); return m; }, [groups]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  useEffect(() => setSel(null), [mode]);
  const hp = hover ? byId.get(hover) : null;
  const selG = sel ? groups.find((g) => g.key === sel) : null;
  const counts = STATUS_ORDER.map((s) => [s, people.filter((p) => p.status === s).length] as const);
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" onClick={stop}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{title}</p>
        <div className="flex rounded-full border bg-muted/40 p-0.5 text-[11px]">
          {MODES.map((m) => (
            <button key={m.key} type="button" onClick={(e) => { stop(e); setMode(m.key); }}
              className={cn("rounded-full px-2.5 py-0.5 transition-colors duration-300", mode === m.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
        {L && L.heads.map((h) => (
          <button key={`${mode}:${h.key}`} type="button" onClick={(e) => { stop(e); setSel(sel === h.key ? null : h.key); }}
            className={cn("absolute flex items-baseline truncate text-left text-[10.5px] font-semibold uppercase tracking-wide transition-[transform,opacity] duration-700 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
              sel && sel !== h.key ? "opacity-30" : "opacity-100")}
            style={{ transform: `translate(${h.x}px, ${h.y}px)`, width: h.w, height: HEAD - 4, left: 0, top: 0 }}>
            <span className="ov-fade flex min-w-0 items-baseline gap-1.5" style={{ animationDelay: "350ms" }}><span className="truncate">{h.label}</span><span className="shrink-0 font-normal tabular-nums text-muted-foreground">{h.n}</span></span>
          </button>
        ))}
        {L && people.map((p, i) => {
          const q = L.pos.get(p.id) ?? { x: box.w / 2, y: box.h / 2 };
          const m = STATUS_META[p.status];
          const x = ready ? q.x : box.w / 2 - L.size / 2, y = ready ? q.y : box.h / 2 - L.size / 2;
          const dim = sel && groupOf.get(p.id) !== sel;
          return (
            <span key={p.id} onMouseEnter={() => setHover(p.id)}
              className={cn("absolute left-0 top-0 flex items-center justify-center rounded-full font-semibold leading-none",
                "transition-[transform,width,height,opacity] duration-[900ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
                m.dot, m.text, hover === p.id && "z-10")}
              style={{
                width: L.size, height: L.size, fontSize: Math.max(7, L.size * 0.36),
                transform: `translate(${x}px, ${y}px) scale(${!ready ? 0 : hover === p.id ? 1.35 : 1})`,
                opacity: dim ? 0.15 : 1, transitionDelay: `${Math.min(i, 220) * (ready ? 2.5 : 0)}ms`,
              }}>
              {L.size >= 20 ? initials(p.name) : null}
            </span>
          );
        })}
      </div>
      <div className="flex min-h-[2.1rem] flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 text-[10.5px]">
        {hp ? (
          <span key={hp.id} className="ov-fade truncate"><b>{hp.name}</b><span className="text-muted-foreground"> · {hp.fn} · {STATUS_META[hp.status].label}{hp.status !== "sem" && hp.status !== "patio" ? ` · ${hp.detail}` : ""}</span></span>
        ) : selG ? (
          <span className="ov-fade truncate"><b>{selG.label}</b><span className="text-muted-foreground"> · {selG.ids.length} pessoas · clique de novo no grupo para ver todos</span></span>
        ) : counts.map(([s, n]) => (
          <span key={s} className="flex items-center gap-1.5 text-muted-foreground"><span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[s].dot)} />{STATUS_META[s].label} <b className="tabular-nums text-foreground">{n}</b></span>
        ))}
      </div>
    </div>
  );
}

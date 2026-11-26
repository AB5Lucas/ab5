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

type Fit = { size: number; gap: number; cw: number; per: number; cols: number[] };
type Layout = { size: number; pos: Map<string, { x: number; y: number }>; heads: { key: string; label: string; n: number; x: number; y: number; w: number }[]; pill: { id: string; x: number; y: number; w: number; h: number } | null };
/** Maior círculo que cabe: grupos em blocos distribuídos em k colunas (o bloco vai para a coluna mais baixa). */
function fitOf(groups: Group[], W: number, H: number): Fit | null {
  for (let size = 34; size >= 7; size--) {
    const gap = Math.max(2, Math.round(size * 0.2));
    for (let k = 1; k <= 4; k++) {
      const cw = (W - (k - 1) * COL_GAP) / k;
      const per = Math.floor((cw + gap) / (size + gap));
      if (per < 1) continue;
      const colsH = Array(k).fill(0) as number[];
      const cols: number[] = [];
      for (const g of groups) {
        const c = colsH.indexOf(Math.min(...colsH));
        cols.push(c);
        colsH[c] = colsH[c]! + HEAD + Math.ceil(g.ids.length / per) * (size + gap) - gap + BLOCK_GAP;
      }
      if (Math.max(...colsH) - BLOCK_GAP <= H) return { size, gap, cw, per, cols };
    }
  }
  return null;
}
/** Largura (em casas) do balão aberto ao passar o mouse: cabe o nome e o local. */
const PILL_CELLS = 4;
/**
 * Posições de cada círculo. Com alguém no mouse, ele ocupa várias casas (o balão): os seguintes do grupo andam para a
 * frente e descem de linha; perto da borda direita o balão abre para a esquerda e quem estava ali vai para depois dele.
 * Os blocos abaixo na mesma coluna descem junto.
 */
function placeOf(groups: Group[], f: Fit, hover: string | null): Layout {
  const { size, gap, cw, per } = f;
  const step = size + gap;
  const cells = Math.max(1, Math.min(per, PILL_CELLS));
  const colsH: number[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  const heads: Layout["heads"] = [];
  let pill: Layout["pill"] = null;
  groups.forEach((g, gi) => {
    const c = f.cols[gi]!;
    const x0 = c * (cw + COL_GAP), y0 = colsH[c] ?? 0;
    heads.push({ key: g.key, label: g.label, n: g.ids.length, x: x0, y: y0, w: cw });
    const hi = hover && per > 1 ? g.ids.indexOf(hover) : -1;
    // Casa de cada item: sem balão, a própria posição.
    const cellOf = (j: number) => j;
    let place = cellOf;
    let pillCell = -1;
    if (hi >= 0) {
      const col = hi % per;
      const s0 = col + cells <= per ? hi : hi - (col + cells - per);
      pillCell = s0;
      place = (j) => (j < s0 ? j : j < hi ? j + cells : j === hi ? s0 : j + cells - 1);
    }
    let used = g.ids.length;
    g.ids.forEach((id, j) => {
      const k = place(j);
      pos.set(id, { x: x0 + (k % per) * step, y: y0 + HEAD + Math.floor(k / per) * step });
      used = Math.max(used, k + 1);
    });
    if (hi >= 0) {
      used = Math.max(used, pillCell + cells);
      const ph = Math.max(size, 34);
      const pp = pos.get(hover!)!;
      pill = { id: hover!, x: pp.x, y: pp.y - (ph - size) / 2, w: cells * step - gap, h: ph };
    }
    colsH[c] = y0 + HEAD + Math.ceil(used / per) * step - gap + BLOCK_GAP;
  });
  return { size, pos, heads, pill };
}

/** Primeiro e segundo nome (pula de/da/do/dos/das/e). */
const twoNames = (n: string) => n.trim().split(/\s+/).filter((w, i) => i === 0 || !/^(d[aeo]s?|e)$/i.test(w)).slice(0, 2)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

export function TeamMosaic({ people, title, dark }: { people: TeamPerson[]; title: string; dark?: boolean }) {
  const [mode, setMode] = useState<Mode>("place");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Troca de balão só depois que o mouse para um instante sobre outro círculo (e só por movimento real do mouse):
  // os círculos que deslizam por baixo do cursor não disparam a troca, senão um balão abria o outro em cadeia.
  const pending = useRef<{ id: string | null; t: ReturnType<typeof setTimeout> | null }>({ id: null, t: null });
  const want = (id: string | null) => {
    const pd = pending.current;
    if (pd.id === id && pd.t) return;
    if (pd.t) clearTimeout(pd.t);
    pd.id = id;
    pd.t = setTimeout(() => { pd.t = null; setHover(id); }, id === null ? 120 : hover ? 140 : 40);
  };
  useEffect(() => () => { if (pending.current.t) clearTimeout(pending.current.t); }, []);
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
  const fit = useMemo(() => (box.w && box.h ? fitOf(groups, box.w, box.h) : null), [groups, box.w, box.h]);
  const L = useMemo(() => (fit ? placeOf(groups, fit, hover) : null), [groups, fit, hover]);
  const groupOf = useMemo(() => { const m = new Map<string, string>(); for (const g of groups) for (const id of g.ids) m.set(id, g.key); return m; }, [groups]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  useEffect(() => setSel(null), [mode]);
  const hp = hover ? byId.get(hover) : null;
  const selG = sel ? groups.find((g) => g.key === sel) : null;
  const counts = STATUS_ORDER.map((s) => [s, people.filter((p) => p.status === s).length] as const);
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", dark && "invert-scope")} onClick={stop}>
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
      <div ref={ref} className="relative min-h-0 flex-1" onMouseLeave={() => want(null)}>
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
          const open = L.pill?.id === p.id ? L.pill : null;
          const x = !ready ? box.w / 2 - L.size / 2 : open ? open.x : q.x;
          const y = !ready ? box.h / 2 - L.size / 2 : open ? open.y : q.y;
          const dim = sel && groupOf.get(p.id) !== sel;
          const where = p.status === "sem" ? "Sem escala" : p.status === "patio" ? "Pátio" : p.detail;
          return (
            <span key={p.id} onMouseMove={() => { if (hover !== p.id || pending.current.t) want(p.id); }}
              className={cn("absolute left-0 top-0 flex items-center overflow-hidden rounded-full font-semibold leading-none",
                "transition-[transform,width,height,opacity,box-shadow] duration-[700ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
                m.dot, m.text, open ? "z-10 justify-start shadow-lg" : "justify-center", open && (p.status === "sem" || p.status === "ausente") && "bg-card")}
              style={{
                width: open ? open.w : L.size, height: open ? open.h : L.size, fontSize: Math.max(7, L.size * 0.36),
                transform: `translate(${x}px, ${y}px) scale(${ready ? 1 : 0})`,
                opacity: dim ? 0.15 : 1, transitionDelay: open || hover ? "0ms" : `${Math.min(i, 220) * (ready ? 2.5 : 0)}ms`,
              }}>
              {open ? (
                <span className="ov-fade flex min-w-0 flex-col gap-0.5 px-3 text-left" style={{ animationDuration: "0.45s", animationDelay: "120ms" }}>
                  <span className="truncate text-[11.5px] font-semibold leading-tight">{twoNames(p.name)}</span>
                  <span className="truncate text-[10px] font-normal leading-tight opacity-75">{where}</span>
                </span>
              ) : L.size >= 20 ? initials(p.name) : null}
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

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, MessageCircle, Plus, Send, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { demandAlerts, driverMessage, isOwn, kg, KIND_LABEL, loadSummary, overlapCounts, timeSpan, type LogAlert } from "@/lib/logistics";
import { DemandDialog, type DemandPreset } from "./demand-dialog";
import { LOG_KEY, transportConflict, useLogData, useTransportBusy, type DemandRow, type Vehicle } from "./use-log-data";

export const todayISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return addDays(d, w === 0 ? -6 : 1 - w); };
export const br = (d: string | null | undefined) => (d ? d.split("-").reverse().slice(0, 2).join("/") : "—");
const DAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

// Grade da agenda: 5h às 22h, 15 min por passo.
const START = 5 * 60, END = 22 * 60, PX = 0.8, SNAP = 15;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const snap = (m: number) => Math.max(START, Math.min(END, Math.round(m / SNAP) * SNAP));
const yToMin = (y: number) => START + y / PX;

/** Situação depois de mover: nosso veículo precisa de veículo e data; cliente/terceiro, de data e horário. */
const statusFor = (d: { carrier?: string | null | undefined; vehicle_id: string | null; scheduled_date: string | null; departure_time: string | null; status: string }) =>
  d.status === "concluida" || d.status === "cancelada" ? d.status
    : d.scheduled_date && ((d.carrier ?? "ab5") === "ab5" ? !!d.vehicle_id : !!d.departure_time) ? "programada" : "pendente";

/** Alertas de todas as demandas abertas (mesmo cálculo do formulário), com sobreposição de horário. */
export function useAlerts(demands: DemandRow[], from: string, to: string) {
  const { base } = useLogData();
  const busy = useTransportBusy(from, to);
  return useMemo(() => {
    const b = base.data;
    const map = new Map<string, LogAlert[]>();
    if (!b) return map;
    const today = todayISO(), now = new Date();
    const ov = overlapCounts(demands);
    for (const d of demands) {
      map.set(d.id, demandAlerts(d, {
        today, now, items: d.items, rules: b.rules, vehicle: b.vehicles.find((v) => v.id === d.vehicle_id), driver: b.drivers.find((x) => x.id === d.driver_id),
        origin: b.addresses.find((a) => a.id === d.origin_id), dest: b.addresses.find((a) => a.id === d.dest_id),
        overlapVehicle: ov.get(d.id)?.vehicle, overlapPlace: ov.get(d.id)?.place,
        ...(isOwn(d) ? transportConflict(busy.data, d.vehicle_id, d.driver_id, d.scheduled_date) : {}),
      }));
    }
    return map;
  }, [demands, base.data, busy.data]);
}
export const toneOf = (a: LogAlert[] | undefined) => (a?.some((x) => x.tone === "red") ? "red" : a?.length ? "orange" : null);

// Cores dos eventos: cada veículo nosso tem uma; cliente = azul; terceiro = roxo.
const PALETTE = [
  "bg-red-50 border-red-500 text-red-950 dark:bg-red-950/40 dark:text-red-100",
  "bg-amber-50 border-amber-500 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  "bg-emerald-50 border-emerald-500 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100",
  "bg-teal-50 border-teal-500 text-teal-950 dark:bg-teal-950/40 dark:text-teal-100",
  "bg-orange-50 border-orange-500 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100",
  "bg-lime-50 border-lime-600 text-lime-950 dark:bg-lime-950/40 dark:text-lime-100",
  "bg-rose-50 border-rose-500 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100",
  "bg-stone-100 border-stone-500 text-stone-950 dark:bg-stone-800/60 dark:text-stone-100",
];
const EXT = { cliente: "bg-sky-50 border-sky-500 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100", terceiro: "bg-violet-50 border-violet-500 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100" };

type Col = { key: string; date: string; title: string; sub?: string; match: (d: DemandRow) => boolean; preset: DemandPreset; vehicleId?: string | null; external?: boolean };
type Drag = { id: string; mode: "move" | "resize"; y0: number; start: number; end: number; col: string; moved: boolean };
type Sel = { col: string; a: number; b: number };

/** Logística › Programação: agenda do dia/semana por horário, como o calendário do Outlook. */
export function AgendaTab({ dashboardDate }: { dashboardDate?: string } = {}) {
  const qc = useQueryClient();
  const [px, setPx] = useState(PX);
  useEffect(() => {
    if (!dashboardDate || !scroller.current) return;
    const node = scroller.current;
    // No dashboard: cabe na altura do quadro, mas nunca menos de 2 px por minuto (120 px por hora); o resto rola.
    const observer = new ResizeObserver(() => setPx(Math.max(2, node.clientHeight / (END - START))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [dashboardDate]);
  const { base, demands } = useLogData();
  const b = base.data;
  const [view, setView] = useState<"dia" | "semana">("semana");
  const [anchor, setAnchor] = useState(todayISO);
  const [show, setShow] = useState("todos");
  const days = dashboardDate ? [dashboardDate] : view === "dia" ? [anchor] : Array.from({ length: 6 }, (_, i) => addDays(mondayOf(anchor), i));
  const from = days[0]!, to = days[days.length - 1]!;
  const all = useMemo(() => (demands.data ?? []).filter((d) => d.status !== "cancelada"), [demands.data]);
  const alerts = useAlerts(all, from, to);
  const overlaps = useMemo(() => overlapCounts(all), [all]);
  const [edit, setEdit] = useState<{ demand?: DemandRow | null; preset?: DemandPreset } | null>(null);
  const [msg, setMsg] = useState<DemandRow | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dashboardYToMin = (y: number) => START + y / px;
  const today = todayISO();
  const [nowMin, setNowMin] = useState(() => { const d = new Date(Date.now() - 3 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); });
  useEffect(() => { const t = setInterval(() => { const d = new Date(Date.now() - 3 * 3600_000); setNowMin(d.getUTCHours() * 60 + d.getUTCMinutes()); }, 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!dashboardDate && scroller.current) scroller.current.scrollTop = (6 * 60 - START) * px; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Dashboard: abre no primeiro horário e desce devagar até o horário atual (uma hora antes, para ver o que vem).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    const node = scroller.current;
    if (!dashboardDate || !node || px === PX) return;
    const key = `${dashboardDate}|${Math.round(px * 100)}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    node.scrollTop = 0;
    const target = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, (Math.max(START, nowMin - 60) - START) * px));
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { node.scrollTop = target; return; }
    let raf = 0; const t0 = performance.now(), dur = 1400;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      node.scrollTop = target * e;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const start = window.setTimeout(() => { raf = requestAnimationFrame(step); }, 400);
    return () => { window.clearTimeout(start); cancelAnimationFrame(raf); };
  }, [dashboardDate, px]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (d: DemandRow) => show === "todos" || (show === "ab5" ? isOwn(d) : !isOwn(d));
  const colorOf = (d: DemandRow) => {
    if (!isOwn(d)) return EXT[d.carrier === "terceiro" ? "terceiro" : "cliente"];
    const i = (b?.vehicles ?? []).findIndex((v) => v.id === d.vehicle_id);
    return i < 0 ? PALETTE[7]! : PALETTE[i % 7]!;
  };

  // Colunas: semana = dias; dia = um por veículo nosso (com carga útil ou com evento) + clientes/terceiros.
  const cols: Col[] = useMemo(() => {
    if (view === "semana") return days.map((d) => ({ key: d, date: d, title: `${DAY[wd(d)]} ${br(d)}`, match: () => true, preset: { date: d } }));
    const date = anchor;
    const used = new Set(all.filter((d) => d.scheduled_date === date && isOwn(d) && d.vehicle_id).map((d) => d.vehicle_id));
    const vs = (b?.vehicles ?? []).filter((v: Vehicle) => used.has(v.id) || (v.status !== "inactive" && Number(v.cargo_capacity_kg) > 0));
    const out: Col[] = show === "externo" ? [] : vs.map((v) => ({
      key: v.id, date, title: v.model ?? v.type ?? v.plate, sub: `${v.plate}${v.cargo_capacity_kg ? ` · ${kg(Number(v.cargo_capacity_kg))}` : ""}`,
      match: (d: DemandRow) => isOwn(d) && d.vehicle_id === v.id, preset: { date, vehicleId: v.id }, vehicleId: v.id,
    }));
    if (show !== "ab5") out.push({ key: "ext", date, title: "Clientes e terceiros", sub: "vêm no horário", match: (d) => !isOwn(d), preset: { date, carrier: "cliente" }, external: true });
    return out;
  }, [view, anchor, days.join(), all, b, show]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async ({ d, patch }: { d: DemandRow; patch: Partial<DemandRow> }) => {
      const next = { ...d, ...patch };
      const { error } = await supabase.from("log_demands").update({ ...patch, status: statusFor(next), updated_at: new Date().toISOString() } as never).eq("id", d.id);
      if (error) throw error;
      return next;
    },
    onMutate: async ({ d, patch }) => {
      await qc.cancelQueries({ queryKey: [...LOG_KEY, "demands"] });
      qc.setQueryData<DemandRow[]>([...LOG_KEY, "demands"], (rows) => rows?.map((r) => (r.id === d.id ? { ...r, ...patch, status: statusFor({ ...r, ...patch }) } : r)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LOG_KEY }),
    onError: (e: Error) => toast.error(e.message),
  });

  const colAt = (x: number) => [...document.querySelectorAll<HTMLElement>("[data-col]")].find((el) => { const r = el.getBoundingClientRect(); return x >= r.left && x < r.right; })?.dataset["col"] ?? null;
  const colTop = (key: string) => (document.querySelector<HTMLElement>(`[data-col="${CSS.escape(key)}"]`)?.getBoundingClientRect().top ?? 0);

  // Arrastar evento (mover / mudar o fim) ou selecionar horário vazio.
  const onEventDown = (e: RPointerEvent, d: DemandRow, col: Col, mode: Drag["mode"]) => {
    e.stopPropagation();
    const span = timeSpan(d)!;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: d.id, mode, y0: e.clientY, start: span.start, end: span.end, col: col.key, moved: false });
  };
  const onMove = (e: RPointerEvent) => {
    if (drag) {
      const d = all.find((x) => x.id === drag.id)!;
      const span = timeSpan(d)!;
      const delta = Math.round((e.clientY - drag.y0) / PX / SNAP) * SNAP;
      const moved = drag.moved || Math.abs(e.clientY - drag.y0) > 4;
      if (drag.mode === "resize") setDrag({ ...drag, end: Math.max(span.start + SNAP, Math.min(END, span.end + delta)), moved });
      else {
        const len = span.end - span.start;
        const start = Math.max(START, Math.min(END - len, span.start + delta));
        const c = colAt(e.clientX);
        const target = cols.find((x) => x.key === c);
        const ok = target && (view === "semana" || (!!target.external === !isOwn(d)));
        setDrag({ ...drag, start, end: start + len, col: ok ? target.key : drag.col, moved });
      }
    } else if (sel) {
      setSel({ ...sel, b: snap(dashboardYToMin(e.clientY - colTop(sel.col))) });
    }
  };
  const onUp = () => {
    if (drag) {
      const d = all.find((x) => x.id === drag.id)!;
      const col = cols.find((c) => c.key === drag.col)!;
      setDrag(null);
      if (!drag.moved) { setEdit({ demand: d }); return; }
      const patch: Partial<DemandRow> = { scheduled_date: col.date, departure_time: hhmm(drag.start), end_time: hhmm(drag.end) };
      if (col.vehicleId && isOwn(d)) patch.vehicle_id = col.vehicleId;
      save.mutate({ d, patch });
    } else if (sel) {
      const col = cols.find((c) => c.key === sel.col)!;
      const a = Math.min(sel.a, sel.b), z = Math.max(sel.a, sel.b);
      setSel(null);
      setEdit({ preset: { ...col.preset, start: hhmm(a), end: hhmm(z > a ? z : Math.min(END, a + 60)) } });
    }
  };
  const onColDown = (e: RPointerEvent, col: Col) => {
    if (e.button !== 0) return;
    const m = snap(dashboardYToMin(e.clientY - colTop(col.key)) - SNAP / 2);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSel({ col: col.key, a: m, b: m });
  };
  // Soltar uma demanda da fila na agenda.
  const onDrop = (e: React.DragEvent, col: Col) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/x-log-demand");
    const d = all.find((x) => x.id === id);
    if (!d) return;
    const start = snap(dashboardYToMin(e.clientY - colTop(col.key)) - 30);
    const len = (timeSpan(d) ? timeSpan(d)!.end - timeSpan(d)!.start : 60);
    const patch: Partial<DemandRow> = { scheduled_date: col.date, departure_time: hhmm(start), end_time: hhmm(Math.min(END, start + len)) };
    if (col.vehicleId && isOwn(d)) patch.vehicle_id = col.vehicleId;
    if (col.external && isOwn(d)) patch.carrier = "cliente";
    save.mutate({ d, patch }, { onSuccess: (next) => { if (isOwn(next) && !next.vehicle_id) { toast.info("Escolha o veículo para programar"); setEdit({ demand: next as DemandRow }); } } });
  };

  // Eventos com horário em cada coluna, lado a lado quando se sobrepõem.
  const laid = (col: Col) => {
    const list = all.filter((d) => visible(d) && d.scheduled_date === col.date && col.match(d) && d.departure_time && drag?.id !== d.id)
      .map((d) => ({ d, ...timeSpan(d)! }));
    if (drag) {
      const d = all.find((x) => x.id === drag.id)!;
      if (drag.col === col.key) list.push({ d, start: drag.start, end: drag.end });
    }
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    const out: { d: DemandRow; start: number; end: number; lane: number; lanes: number }[] = [];
    let group: typeof out = [], groupEnd = -1;
    const flush = () => { const n = Math.max(...group.map((g) => g.lane)) + 1; group.forEach((g) => (g.lanes = n)); out.push(...group); group = []; };
    for (const ev of list) {
      if (group.length && ev.start >= groupEnd) flush();
      const lanesEnd: number[] = [];
      group.forEach((g) => { lanesEnd[g.lane] = Math.max(lanesEnd[g.lane] ?? 0, g.end); });
      let lane = lanesEnd.findIndex((x) => x <= ev.start);
      if (lane < 0) lane = lanesEnd.length;
      group.push({ ...ev, lane, lanes: 1 });
      groupEnd = Math.max(groupEnd, ev.end);
    }
    if (group.length) flush();
    return out;
  };
  const untimed = (col: Col) => all.filter((d) => visible(d) && d.scheduled_date === col.date && col.match(d) && !d.departure_time);

  const queue = all.filter((d) => d.status === "pendente" && visible(d)).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const rangeAlerts = all.filter((d) => (d.status === "pendente" || (d.scheduled_date && d.scheduled_date >= from && d.scheduled_date <= to)) && alerts.get(d.id)?.length);
  const label = view === "dia"
    ? `${DAY[wd(anchor)]}, ${Number(anchor.slice(8))} de ${MONTH[Number(anchor.slice(5, 7)) - 1]} de ${anchor.slice(0, 4)}`
    : `${br(from)} a ${br(to)} de ${to.slice(0, 4)}`;
  const hours = Array.from({ length: (END - START) / 60 }, (_, i) => START + i * 60);
  const subtitle = (d: DemandRow) => {
    if (!isOwn(d)) return [d.carrier_name || b?.clients.find((c) => c.id === d.client_id)?.name, d.carrier_plate].filter(Boolean).join(" · ") || (d.carrier === "terceiro" ? "Terceiro" : "Cliente");
    const v = b?.vehicles.find((x) => x.id === d.vehicle_id);
    const dr = b?.drivers.find((x) => x.id === d.driver_id);
    return [view === "semana" ? v?.plate : null, dr?.full_name.split(" ")[0], d.items.length ? kg(loadSummary(d.items).weight) : null, d.trips > 1 ? `${d.trips} viagens` : null].filter(Boolean).join(" · ");
  };

  return (
    <div className={cn(dashboardDate ? "flex h-full min-h-0 flex-col" : "grid gap-4 xl:grid-cols-[1fr_300px]")}>
      <div className={cn("min-w-0", dashboardDate ? "flex min-h-0 flex-1 flex-col" : "space-y-3")}>
        {!dashboardDate && <div className="flex flex-wrap items-end gap-2">
          <Button variant="outline" onClick={() => setAnchor(todayISO())}>Hoje</Button>
          <Button variant="ghost" size="icon" aria-label="Anterior" onClick={() => setAnchor(addDays(anchor, view === "dia" ? (wd(anchor) === 1 ? -2 : -1) : -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Próximo" onClick={() => setAnchor(addDays(anchor, view === "dia" ? (wd(anchor) === 6 ? 2 : 1) : 7))}><ChevronRight className="h-4 w-4" /></Button>
          <span className="px-1 pb-2 text-base font-semibold">{label}</span>
          <div className="flex-1" />
          <div className="space-y-1"><Label className="block">Mostrar</Label>
            <Select value={show} onValueChange={setShow}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Tudo</SelectItem><SelectItem value="ab5">Só veículos AB5</SelectItem><SelectItem value="externo">Só clientes e terceiros</SelectItem></SelectContent></Select></div>
          <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Visualização">
            {(["dia", "semana"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn("rounded px-3 py-1.5 text-sm", view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{v === "dia" ? "Dia" : "Semana"}</button>
            ))}
          </div>
          <Button onClick={() => setEdit({ preset: { date: view === "dia" ? anchor : undefined } })}><Plus className="h-4 w-4" /> Novo evento</Button>
        </div>}

        <div className={cn("rounded-md border border-border bg-card", dashboardDate ? "min-h-0 flex-1 overflow-hidden" : "overflow-x-auto")}>
          <div className={dashboardDate ? "flex h-full flex-col" : undefined} style={{ minWidth: 64 + cols.length * 130 }}>
            {/* Cabeçalho das colunas + linha "dia inteiro" (sem horário). */}
            <div className="flex border-b border-border">
              <div className="w-16 shrink-0" />
              {cols.map((c) => (
                <div key={c.key} className="min-w-0 flex-1 border-l border-border px-2 py-1.5">
                  <button type="button" className={cn("block w-full truncate text-left text-sm font-semibold", view === "semana" && "hover:underline", c.date === today && view === "semana" && (dashboardDate ? "text-muted-foreground" : "text-primary"))}
                    onClick={() => { if (view === "semana") { setAnchor(c.date); setView("dia"); } }}>{c.title}</button>
                  {c.sub && <div className="truncate text-[11px] text-muted-foreground">{c.sub}</div>}
                </div>
              ))}
            </div>
            {cols.some((c) => untimed(c).length) && (
              <div className="flex border-b border-border bg-muted/30">
                <div className="w-16 shrink-0 px-1 py-1 text-right text-[10px] text-muted-foreground">sem horário</div>
                {cols.map((c) => (
                  <div key={c.key} className="min-w-0 flex-1 space-y-0.5 border-l border-border p-1">
                    {untimed(c).map((d) => (
                      <button type="button" key={d.id} onClick={() => setEdit({ demand: d })} className={cn("block w-full truncate rounded border-l-4 px-1.5 py-0.5 text-left text-[11px]", colorOf(d))}>{d.title}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div ref={scroller} className={cn("relative", dashboardDate ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[66vh] overflow-y-auto")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { setDrag(null); setSel(null); }}>
              <div className="flex select-none" style={{ height: (END - START) * px }}>
                <div className="relative w-16 shrink-0">
                  {hours.map((h) => <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground" style={{ top: (h - START) * px }}>{h > START ? `${h / 60}h` : ""}</div>)}
                </div>
                {cols.map((c) => (
                  <div key={c.key} data-col={c.key} className={cn("relative min-w-0 flex-1 cursor-cell border-l border-border", c.date === today && view === "semana" && (dashboardDate ? "bg-muted/20" : "bg-primary/[0.03]"))}
                    onPointerDown={(e) => onColDown(e, c)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, c)}>
                    {hours.map((h) => (
                      <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: (h - START) * px }}>
                        <div className="border-t border-dashed border-border/40" style={{ marginTop: 30 * px }} />
                      </div>
                    ))}
                    {sel?.col === c.key && (
                      <div className="pointer-events-none absolute inset-x-1 rounded bg-primary/15 ring-1 ring-primary"
                        style={{ top: (Math.min(sel.a, sel.b) - START) * px, height: Math.max(SNAP, Math.abs(sel.b - sel.a)) * px }}>
                        <span className="px-1 text-[11px] font-medium text-primary">{hhmm(Math.min(sel.a, sel.b))}–{hhmm(Math.max(sel.a, sel.b) > Math.min(sel.a, sel.b) ? Math.max(sel.a, sel.b) : Math.min(sel.a, sel.b) + 60)}</span>
                      </div>
                    )}
                    {c.date === today && nowMin >= START && nowMin <= END && (
                      <div className={cn("pointer-events-none absolute inset-x-0 z-20 border-t-2", dashboardDate ? "border-muted-foreground" : "border-destructive")} style={{ top: (nowMin - START) * px }}>
                        <span className={cn("absolute -left-1 -top-[5px] h-2 w-2 rounded-full", dashboardDate ? "bg-muted-foreground" : "bg-destructive")} />
                      </div>
                    )}
                    {laid(c).map(({ d, start, end, lane, lanes }) => {
                      const t = toneOf(alerts.get(d.id));
                      const h = (end - start) * px;
                      const dragging = drag?.id === d.id;
                      return (
                        <div key={d.id} role="button" tabIndex={0} aria-label={`${d.title}, ${hhmm(start)} às ${hhmm(end)}`}
                          onKeyDown={(e) => { if (e.key === "Enter") setEdit({ demand: d }); }}
                          onPointerDown={(e) => onEventDown(e, d, c, "move")}
                          className={cn("absolute z-10 cursor-grab overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-[11px] leading-tight shadow-sm", colorOf(d),
                            d.status === "concluida" && "opacity-55", dragging && "z-30 cursor-grabbing opacity-90 shadow-lg ring-2 ring-primary", t === "red" && "ring-1 ring-destructive")}
                          style={{ top: (start - START) * px + 1, height: Math.max(h - 2, 14), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                          <div className="flex items-start gap-1">
                            <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
                            {t && <TriangleAlert aria-label="Com alerta" className={cn("h-3 w-3 shrink-0", t === "red" ? "text-destructive" : "text-orange-500")} />}
                          </div>
                          {h > 26 && <div className="truncate opacity-80">{hhmm(start)}–{hhmm(end)}{isOwn(d) ? "" : ` · ${d.carrier === "terceiro" ? "Terceiro" : "Cliente"}`}</div>}
                          {h > 40 && <div className="truncate opacity-80">{subtitle(d)}</div>}
                          {h > 54 && <div className="truncate opacity-70">{KIND_LABEL[d.kind]}</div>}
                          <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => onEventDown(e, d, c, "resize")} aria-hidden="true" />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {!dashboardDate && <p className="text-xs text-muted-foreground">
          Clique ou arraste num horário vazio para criar. Arraste o evento para mudar dia, horário{view === "dia" ? " ou veículo" : ""}; puxe a borda de baixo para mudar o fim.
          Cores: cada veículo AB5 tem uma; <span className="font-medium text-sky-700 dark:text-sky-300">azul = cliente</span>, <span className="font-medium text-violet-700 dark:text-violet-300">roxo = terceiro</span>. Clique no dia (semana) para abrir o dia por veículo.
        </p>}
      </div>

      {!dashboardDate && <div className="space-y-4">
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wide">Fila para programar ({queue.length})</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">Arraste para a agenda.</p>
          {!queue.length && <p className="text-xs text-muted-foreground">Nenhuma demanda na fila.</p>}
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {queue.map((d) => {
              const t = toneOf(alerts.get(d.id));
              return (
                <li key={d.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/x-log-demand", d.id); e.dataTransfer.effectAllowed = "move"; }}>
                  <button type="button" onClick={() => setEdit({ demand: d })} className="w-full cursor-grab rounded-md border border-border p-2 text-left text-xs hover:bg-muted/50">
                    <div className="flex justify-between gap-2 font-medium"><span className="truncate">{d.title}</span>{t && <span aria-hidden="true" className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", t === "red" ? "bg-destructive" : "bg-orange-500")} />}</div>
                    <div className="text-muted-foreground">{KIND_LABEL[d.kind]}{d.items.length ? ` · ${kg(loadSummary(d.items).weight)}` : ""} · prazo {br(d.due_date)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">Alertas</h2>
          {!rangeAlerts.length && <p className="text-xs text-emerald-600">Nenhum alerta no período.</p>}
          <ul className="max-h-96 space-y-2 overflow-y-auto text-xs">
            {rangeAlerts.map((d) => (
              <li key={d.id}>
                <button type="button" className="font-medium hover:underline" onClick={() => setEdit({ demand: d })}>{d.title}{d.scheduled_date ? ` · ${br(d.scheduled_date)}${d.departure_time ? ` ${d.departure_time.slice(0, 5)}` : ""}` : ""}</button>
                <ul className="mt-0.5 space-y-0.5">
                  {alerts.get(d.id)!.map((a, i) => <li key={i} className="flex gap-1.5"><span aria-hidden="true" className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", a.tone === "red" ? "bg-destructive" : "bg-orange-500")} />{a.text}</li>)}
                </ul>
                {d.scheduled_date === addDays(today, 1) && !d.message_sent_at && (isOwn(d) || d.carrier_phone) && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setMsg(d)}>Gerar mensagem</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>}
      <DemandDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} demand={edit?.demand} preset={edit?.preset} overlap={edit?.demand ? overlaps.get(edit.demand.id) : undefined} />
      <MessageDialog demand={msg} onClose={() => setMsg(null)} />
    </div>
  );
}

/** Mensagem da véspera: motorista AB5 (telefone do cadastro) ou cliente/terceiro (telefone digitado). */
export function MessageDialog({ demand, onClose }: { demand: DemandRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { base } = useLogData();
  const b = base.data;
  const own = demand ? isOwn(demand) : true;
  const driver = b?.drivers.find((x) => x.id === demand?.driver_id);
  const text = demand && b ? driverMessage(demand, {
    items: demand.items, rules: b.rules, vehicle: b.vehicles.find((v) => v.id === demand.vehicle_id), driver,
    origin: b.addresses.find((a) => a.id === demand.origin_id), dest: b.addresses.find((a) => a.id === demand.dest_id),
  }) : "";
  const who = own ? driver?.full_name : demand?.carrier_driver || demand?.carrier_name;
  const phone = ((own ? driver?.phone : demand?.carrier_phone) ?? "").replace(/\D/g, "");
  const wa = `https://wa.me/${phone ? (phone.startsWith("55") ? phone : `55${phone}`) : ""}?text=${encodeURIComponent(text)}`;
  const mark = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("log_demands").update({ message_sent_at: new Date().toISOString() }).eq("id", demand!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Envio registrado"); qc.invalidateQueries({ queryKey: LOG_KEY }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!demand} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mensagem da véspera</DialogTitle>
          <DialogDescription>{who ? `${who}${phone ? "" : " (sem telefone)"}` : "Sem motorista definido"}. Copie ou abra no WhatsApp e marque como enviada.</DialogDescription>
        </DialogHeader>
        <Textarea readOnly value={text} className="min-h-72 font-mono text-xs" />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(text); toast.success("Texto copiado"); }}><Copy className="h-4 w-4" /> Copiar</Button>
          <div className="flex gap-2">
            <Button variant="outline" asChild><a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp</a></Button>
            <Button disabled={mark.isPending || !demand} onClick={() => mark.mutate()}><Send className="h-4 w-4" /> Marcar enviada</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

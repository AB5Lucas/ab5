import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TransferHandle = { move: (source: HTMLElement, timeline: HTMLElement, chart: HTMLElement, swap: () => void, delivered: () => void, day: number) => void };
type Scene = { size: number; day: number; carrying: boolean; lift: number; helper: boolean };
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Measured viewport paths keep the forklifts aligned with the real calendar cells and destination panels. */
export const ForkliftTransfer = forwardRef<TransferHandle>(function ForkliftTransfer(_, ref) {
  const [scene, setScene] = useState<Scene | null>(null);
  const truck = useRef<HTMLDivElement>(null);
  const helper = useRef<HTMLDivElement>(null);
  const run = useRef(0);
  const animations = useRef<Animation[]>([]);
  useEffect(() => () => { run.current++; animations.current.forEach((a) => a.cancel()); }, []);
  useImperativeHandle(ref, () => ({ move(source, timeline, chart, swap, delivered, day) {
    const seq = ++run.current;
    animations.current.forEach((a) => a.cancel()); animations.current = [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || innerWidth < 1024;
    const s = source.getBoundingClientRect(), oldT = timeline.getBoundingClientRect(), oldC = chart.getBoundingClientRect();
    if (reduced) { swap(); delivered(); setScene(null); return; }
    const size = Math.min(s.width, s.height), ground = Math.min(innerHeight - size - 12, Math.max(s.bottom, oldT.bottom));
    const animate = async (el: HTMLElement, frames: Keyframe[], duration: number) => {
      const a = el.animate(frames, { duration, easing: "cubic-bezier(.32,.72,.3,1)", fill: "forwards" });
      animations.current.push(a); await a.finished;
      if (seq !== run.current) throw new Error("superseded");
    };
    const travel = (el: HTMLElement, x0: number, y0: number, x1: number, y1: number, duration: number) => animate(el, [{ transform: `translate(${x0}px,${y0}px)` }, { transform: `translate(${x1}px,${y1}px)` }], duration);
    void (async () => {
      try {
        setScene({ size, day, carrying: false, lift: 0, helper: true }); await frame(); await frame();
        swap(); await frame(); await frame();
        const t = timeline.getBoundingClientRect(), c = chart.getBoundingClientRect();
        if (Math.abs(t.top - oldT.top) > 5) {
          if (helper.current) {
            await travel(helper.current, -size * 2, oldT.bottom - size, oldT.left - size, oldT.bottom - size, 500);
          }
          const tasks = [animate(timeline, [{ transform: `translateY(${oldT.top - t.top}px)` }, { transform: "translateY(0)" }], 750), animate(chart, [{ transform: `translateY(${oldC.top - c.top}px)` }, { transform: "translateY(0)" }], 750)];
          if (helper.current) tasks.push(travel(helper.current, t.left - size, oldT.bottom - size, t.left - size, t.bottom - size, 750));
          await Promise.all(tasks);
          if (helper.current) await travel(helper.current, t.left - size, t.bottom - size, -size * 2, t.bottom - size, 350);
        }
        if (!truck.current) return;
        await travel(truck.current, -size * 2, ground, s.left - size, ground, 650);
        setScene({ size, day, carrying: false, lift: Math.max(0, ground - s.top), helper: false });
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (seq !== run.current) return;
        setScene({ size, day, carrying: true, lift: Math.max(0, ground - s.top), helper: false });
        await travel(truck.current, s.left - size, ground, t.left + size / 2, ground, 950);
        setScene({ size, day, carrying: true, lift: Math.max(0, ground - (t.top + 50)), helper: false });
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (seq !== run.current) return;
        delivered(); setScene({ size, day, carrying: false, lift: 0, helper: false });
        await travel(truck.current, t.left + size / 2, ground, innerWidth + size, ground, 650);
        if (seq === run.current) setScene(null);
      } catch { if (seq === run.current) { delivered(); setScene(null); } }
    })();
  } }));
  if (!scene || typeof document === "undefined") return null;
  return createPortal(<div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
    <div ref={helper} className={scene.helper ? "fleet-forklift fixed left-0 top-0" : "hidden"} style={{ width: scene.size, height: scene.size }}><Forklift /></div>
    <div ref={truck} className="fleet-forklift fixed left-0 top-0" style={{ width: scene.size, height: scene.size }}>
      <Forklift />
      {scene.lift > 0 && <div className="absolute bottom-1 left-[76%] w-1 border border-background/50 bg-foreground" style={{ height: scene.lift + scene.size * 0.7 }} />}
      <div className="fleet-forklift-forks absolute bottom-1 left-[78%]" style={{ transform: `translateY(-${scene.lift}px)` }}>
        <div className="h-1 w-12 bg-foreground" />
        {scene.carrying && <div className="absolute bottom-1 left-0 flex items-center justify-center rounded-md border border-background/40 bg-foreground font-display text-lg font-semibold text-background shadow-lg" style={{ width: scene.size, height: scene.size }}>{scene.day}</div>}
      </div>
    </div>
  </div>, document.body);
});

function Forklift() {
  return <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible text-foreground" fill="currentColor">
    <path d="M9 59h40v-9h13v28H9z" /><path d="M18 56V25h36v34h-5V30H23v26z" /><path d="M69 13h5v71h-5zM75 78h24v5H75z" />
    <path d="M13 63h23v5H13z" className="fill-background/50" /><path d="M43 42h7v16h-7z" className="fill-muted-foreground" />
    <circle cx="24" cy="81" r="11" /><circle cx="60" cy="81" r="10" /><circle cx="24" cy="81" r="5" className="fill-muted-foreground" /><circle cx="60" cy="81" r="4" className="fill-muted-foreground" />
    <circle cx="39" cy="37" r="5" className="fill-muted-foreground" /><path d="M35 43h9l3 14H33z" className="fill-muted-foreground" />
  </svg>;
}
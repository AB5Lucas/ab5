import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Tela de referência dos dashboards (área de conteúdo do monitor do Lucas). */
const DESIGN_W = 1360;
const DESIGN_H = 890;

/**
 * Mostra o dashboard sempre com o mesmo desenho da tela de referência,
 * aumentando ou diminuindo tudo para caber na tela sem rolar.
 * Em telas pequenas (< 1024 px) volta ao layout normal empilhado.
 */
export function FitScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (window.innerWidth < 1024) return setScale(null);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const availH = window.innerHeight - top - 12;
      const availW = el.clientWidth;
      setScale(Math.max(0.4, Math.min(availW / DESIGN_W, availH / DESIGN_H)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  return (
    <div ref={ref} className="w-full" style={scale ? { height: DESIGN_H * scale } : undefined}>
      {scale ? (
        <div style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})`, transformOrigin: "top left", marginLeft: Math.max(0, (ref.current?.clientWidth ?? 0) - DESIGN_W * scale) / 2 }}>
          {children}
        </div>
      ) : children}
    </div>
  );
}

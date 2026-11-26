import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Tela de referência dos dashboards (área de conteúdo do monitor do Lucas). */
const REF_W = 1480; // janela do navegador de referência
const REF_H = 997;
const CHROME_H = 104; // cabeçalho + margens (6,5rem), como antes

/**
 * Mostra o dashboard sempre com o mesmo desenho da tela de referência,
 * aumentando ou diminuindo tudo para caber na tela sem rolar.
 * Em telas pequenas (< 1024 px) volta ao layout normal empilhado.
 */
export function FitScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; w: number; h: number; ml: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (window.innerWidth < 1024) return setFit(null);
      const availW = el.clientWidth;
      const side = window.innerWidth - availW; // menu + margens laterais
      const w = REF_W - side;
      const h = REF_H - CHROME_H;
      const availH = window.innerHeight - CHROME_H;
      const scale = Math.max(0.4, Math.min(availW / w, availH / h));
      setFit({ scale, w, h, ml: Math.max(0, availW - w * scale) / 2 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  return (
    <div ref={ref} className="w-full" style={fit ? { height: fit.h * fit.scale } : undefined}>
      {fit ? (
        <div style={{ width: fit.w, height: fit.h, transform: fit.scale === 1 ? undefined : `scale(${fit.scale})`, transformOrigin: "top left", marginLeft: fit.ml }}>
          {children}
        </div>
      ) : children}
    </div>
  );
}

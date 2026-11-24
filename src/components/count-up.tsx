/**
 * Número que "sobe" de 0 até o valor real em ~0,9 s (efeito de painel).
 * Aceita número ou texto já formatado em pt-BR ("R$ 12.345,67", "87%", "1.234 km"): anima só a parte numérica,
 * mantendo prefixo, sufixo e casas decimais. Texto sem número (ex.: "—") aparece direto.
 * Quem prefere menos movimento (prefers-reduced-motion) vê o valor final na hora.
 */
import { useEffect, useRef, useState } from "react";

type Parsed = { prefix: string; suffix: string; value: number; decimals: number; group: boolean };

export function parseFormatted(text: string): Parsed | null {
  const m = /^(.*?)(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?)(.*)$/s.exec(text);
  if (!m) return null;
  const num = m[2]!;
  const decimals = num.includes(",") ? num.split(",")[1]!.length : 0;
  const value = Number(num.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1]!, suffix: m[3]!, value, decimals, group: num.includes(".") || Math.abs(value) >= 1000 };
}

export function formatLike(p: Parsed, v: number) {
  const s = v.toLocaleString("pt-BR", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.group });
  return `${p.prefix}${s}${p.suffix}`;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function CountUp({ value, duration = 900, className }: { value: number | string | null | undefined; duration?: number; className?: string }) {
  const text = value == null ? "—" : typeof value === "number" ? value.toLocaleString("pt-BR") : value;
  const parsed = parseFormatted(text);
  const [shown, setShown] = useState(() => (parsed && !reduced() ? formatLike(parsed, 0) : text));
  const from = useRef(0);
  useEffect(() => {
    if (!parsed || reduced()) { setShown(text); return; }
    const start = performance.now();
    const a = from.current;
    const b = parsed.value;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = a + (b - a) * eased;
      setShown(t < 1 ? formatLike(parsed, v) : text);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = b; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <span className={className}>{shown}</span>;
}

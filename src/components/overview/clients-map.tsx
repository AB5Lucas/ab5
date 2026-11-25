import type React from "react";
/**
 * Mapa dos clientes (Atividades): desenho próprio (sem API). Por padrão só clientes com atividade no período
 * (faturamento, escala ou RDO); o olho mostra todos. Botão de expandir alterna SP/Brasil no próprio quadro.
 */
import { useEffect, useState } from "react";
import { Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import { AnimatedMap, inState, ufOf } from "./animated-map";

export type MapClient = { id: string; name: string; lat: number; lon: number; city?: string | null; billed?: number; marginPct?: number | null; active?: boolean };

const btn = "flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background";

/** O quadro do mapa é invertido em relação ao tema (escuro no claro, claro no escuro): acompanha a troca. */
function useInvertedTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement, upd = () => setDark(el.classList.contains("dark"));
    upd(); const mo = new MutationObserver(upd); mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark ? "light-inverse" : "dark";
}

export function ClientsMap({ clients, className }: { clients: MapClient[]; className?: string }) {
  const [region, setRegion] = useState<"SP" | "BR">("SP");
  const [all, setAll] = useState(false);
  const themeCls = useInvertedTheme();
  const base = all ? clients : clients.filter((c) => c.active);
  const list = region === "SP" ? base.filter((c) => inState("SP", c.lon, c.lat)) : base;
  const [focus, setFocus] = useState<{ lon: number; lat: number; n: number; uf?: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const pick = (c: MapClient) => {
    const sp = inState("SP", c.lon, c.lat);
    if (!sp && region === "SP") setRegion("BR");
    if (sp && region === "BR") setRegion("SP");
    setSelected(c.id); setFocus((f) => ({ lon: c.lon, lat: c.lat, n: (f?.n ?? 0) + 1, uf: ufOf(c.lon, c.lat) }));
  };
  const listed = [...base].sort((a, b) => (b.billed ?? 0) - (a.billed ?? 0) || a.name.localeCompare(b.name));
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div className={`${themeCls} grid gap-3 text-foreground md:grid-cols-[1fr_240px]`}><div className="relative">
      <AnimatedMap clients={list} region={region} className={className ?? "h-[340px] w-full rounded-xl border"} extra={<>
        <button type="button" className={btn} title={region === "SP" ? "Expandir (Brasil)" : "Voltar para SP"} onClick={(e) => { stop(e); setRegion((r) => (r === "SP" ? "BR" : "SP")); }}>
          {region === "SP" ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className={btn} title={all ? "Mostrar só clientes com atividade no período" : "Mostrar todos os clientes"} aria-pressed={all} onClick={(e) => { stop(e); setAll((v) => !v); }}>
          {all ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </>} focus={focus} selected={selected} />
    </div>
    <ul className="max-h-[480px] space-y-0.5 overflow-y-auto pr-1 text-xs">
      {listed.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={(e) => { stop(e); pick(c); }}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted ${selected === c.id ? "bg-muted" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${c.active ? "bg-foreground" : "bg-foreground/25"}`} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span>{c.city && <span className="block truncate text-[10px] text-muted-foreground">{c.city}</span>}</span>
            {!!c.billed && <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{brl(c.billed)}</span>}
          </button>
        </li>
      ))}
      {!listed.length && <li className="py-6 text-center text-muted-foreground">Nenhum cliente com atividade no período.</li>}
    </ul>
    </div>
  );
}

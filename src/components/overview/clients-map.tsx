import type React from "react";
/**
 * Mapa dos clientes (Atividades): desenho próprio (sem API). Por padrão só clientes com atividade no período
 * (faturamento, escala ou RDO); o olho mostra todos. Botão de expandir alterna SP/Brasil no próprio quadro.
 */
import { useState } from "react";
import { Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import { AnimatedMap, inState } from "./animated-map";

export type MapClient = { id: string; name: string; lat: number; lon: number; city?: string | null; billed?: number; marginPct?: number | null; active?: boolean };

const btn = "flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background";

export function ClientsMap({ clients, className }: { clients: MapClient[]; className?: string }) {
  const [region, setRegion] = useState<"SP" | "BR">("SP");
  const [all, setAll] = useState(false);
  const base = all ? clients : clients.filter((c) => c.active);
  const list = region === "SP" ? base.filter((c) => inState("SP", c.lon, c.lat)) : base;
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div className="relative h-full">
      <AnimatedMap clients={list} region={region} className={className ?? "h-[340px] w-full rounded-xl border"} extra={<>
        <button type="button" className={btn} title={region === "SP" ? "Expandir (Brasil)" : "Voltar para SP"} onClick={(e) => { stop(e); setRegion((r) => (r === "SP" ? "BR" : "SP")); }}>
          {region === "SP" ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className={btn} title={all ? "Mostrar só clientes com atividade no período" : "Mostrar todos os clientes"} aria-pressed={all} onClick={(e) => { stop(e); setAll((v) => !v); }}>
          {all ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </>} />
    </div>
  );
}

/**
 * Mapa dos clientes (visão geral de Atividades): desenho próprio (sem API de mapas). Começa em SP (só clientes do estado);
 * "Expandir (Brasil)" refaz a animação com o Brasil e todos os clientes no próprio quadro.
 */
import { useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { AnimatedMap, inState } from "./animated-map";

export type MapClient = { id: string; name: string; lat: number; lon: number; city?: string | null; billed?: number; marginPct?: number | null };

export function ClientsMap({ clients, className }: { clients: MapClient[]; className?: string }) {
  const [region, setRegion] = useState<"SP" | "BR">("SP");
  const list = region === "SP" ? clients.filter((c) => inState("SP", c.lon, c.lat)) : clients;
  return (
    <div className="relative h-full">
      <AnimatedMap clients={list} region={region} className={className ?? "h-[340px] w-full rounded-xl border"} />
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRegion((r) => (r === "SP" ? "BR" : "SP")); }}
        className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-xs text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background">
        {region === "SP" ? <><Maximize2 className="h-3.5 w-3.5" /> Expandir (Brasil)</> : <><Minimize2 className="h-3.5 w-3.5" /> Voltar para SP</>}
      </button>
    </div>
  );
}

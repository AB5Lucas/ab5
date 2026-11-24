/**
 * Mapa dos clientes (visão geral de Atividades): mapa claro em tons de cinza (CARTO/OpenStreetMap) com um marcador por
 * cliente (clients.lat/lon); o tamanho do marcador segue o faturado no período. Começa em São Paulo e "Expandir" abre o
 * mapa do Brasil num quadro grande.
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Maximize2 } from "lucide-react";
import { AnimatedMap } from "./animated-map";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type MapClient = { id: string; name: string; lat: number; lon: number; city?: string | null; billed?: number; marginPct?: number | null };

const SP: [[number, number], [number, number]] = [[-25.3, -53.1], [-19.8, -44.2]];
const BR: [[number, number], [number, number]] = [[-33.8, -73.9], [5.3, -34.8]];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function LeafletMap({ clients, bounds, className }: { clients: MapClient[]; bounds: typeof SP; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: any; let off = false;
    void import("leaflet").then((L) => {
      if (off || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "© OpenStreetMap © CARTO", subdomains: "abcd", maxZoom: 18,
      }).addTo(map);
      map.fitBounds(bounds);
      const max = Math.max(1, ...clients.map((c) => c.billed ?? 0));
      for (const c of clients) {
        const r = 5 + Math.sqrt((c.billed ?? 0) / max) * 9;
        L.circleMarker([c.lat, c.lon], { radius: r, color: "#ffffff", weight: 2, fillColor: "#111111", fillOpacity: 0.85 })
          .bindTooltip(`<b>${c.name}</b>${c.city ? `<br/>${c.city}` : ""}${c.billed ? `<br/>Faturado: ${brl(c.billed)}` : ""}${c.marginPct != null ? `<br/>Margem: ${c.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}`, { direction: "top" })
          .addTo(map);
      }
      setTimeout(() => map.invalidateSize(), 200);
    });
    return () => { off = true; if (map) map.remove(); };
  }, [clients, bounds]);
  return <div ref={el} className={className} />;
}

export function ClientsMap({ clients }: { clients: MapClient[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"3d" | "classic">("3d");
  useEffect(() => { if (localStorage.getItem("clients-map-mode") === "classic") setMode("classic"); }, []);
  const pick = (m: "3d" | "classic") => { setMode(m); localStorage.setItem("clients-map-mode", m); };
  return (
    <div className="relative">
      {mode === "3d"
        ? <AnimatedMap clients={clients} region="SP" className="h-[340px] w-full rounded-xl border" />
        : <LeafletMap clients={clients} bounds={SP} className="h-[340px] w-full overflow-hidden rounded-xl border grayscale-[0.2]" />}
      <div className="absolute left-2 top-2 z-[400] flex rounded-full border bg-background/90 p-0.5 text-xs shadow-sm backdrop-blur">
        {(["3d", "classic"] as const).map((m) => (
          <button key={m} type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); pick(m); }}
            className={`rounded-full px-2.5 py-0.5 ${mode === m ? "bg-foreground text-background" : "text-muted-foreground"}`}>
            {m === "3d" ? "Animado" : "Clássico"}
          </button>
        ))}
      </div>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="absolute right-2 top-2 z-[400] flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur transition-colors hover:bg-background">
        <Maximize2 className="h-3.5 w-3.5" /> Expandir (Brasil)
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col">
          <DialogHeader><DialogTitle>Clientes no mapa</DialogTitle></DialogHeader>
          {open && (mode === "3d"
            ? <AnimatedMap clients={clients} region="BR" className="min-h-0 w-full flex-1 rounded-xl border" />
            : <LeafletMap clients={clients} bounds={BR} className="min-h-0 w-full flex-1 overflow-hidden rounded-xl border" />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

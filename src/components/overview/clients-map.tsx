/**
 * Mapa dos clientes (visão geral de Atividades): desenho próprio (sem API de mapas). No quadro aparecem só os clientes
 * dentro do estado de SP; "Expandir (Brasil)" abre o Brasil inteiro com todos os clientes.
 */
import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnimatedMap, inState } from "./animated-map";

export type MapClient = { id: string; name: string; lat: number; lon: number; city?: string | null; billed?: number; marginPct?: number | null };

export function ClientsMap({ clients, className }: { clients: MapClient[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const sp = clients.filter((c) => inState("SP", c.lon, c.lat));
  return (
    <div className="relative">
      <AnimatedMap clients={sp} region="SP" className={className ?? "h-[340px] w-full rounded-xl border"} />
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-xs text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background">
        <Maximize2 className="h-3.5 w-3.5" /> Expandir (Brasil)
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col">
          <DialogHeader><DialogTitle>Clientes no mapa</DialogTitle></DialogHeader>
          {open && <AnimatedMap clients={clients} region="BR" className="min-h-0 w-full flex-1 rounded-xl border" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

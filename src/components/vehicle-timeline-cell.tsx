import { memo } from "react";
import { AlertTriangle, Package } from "lucide-react";
import type { VehicleScheduleRow } from "@/components/vehicle-timeline-shared";

/**
 * Célula da grade da Transporte. Recebe tudo já pronto (textos e marcas) e só redesenha quando a própria célula muda.
 */
export const VehicleTimelineCell = memo(function VehicleTimelineCell(props: {
  vehicleId: string;
  date: string;
  weekend: boolean;
  row: VehicleScheduleRow | undefined;
  canWrite: boolean;
  driverText: string;
  placeText: string;
  extrasTitle: string | undefined;
  extrasCount: number;
  /** Km rodados no dia (dayKm da Frota: ida e volta × viagens + km dos fretes extras). */
  km: number;
  bonusTone: "undefined" | "bonus" | "none";
  /** Motorista desta célula também escalado em outro veículo no dia. */
  dupDriver: string | undefined;
  /** Demandas da Logística programadas para o veículo no dia. */
  logistics: string | undefined;
  onOpen: (vehicleId: string, date: string) => void;
  onDropRow: (vehicleId: string, date: string, payload: string) => void;
}) {
  const { row } = props;
  return (
    <td
      className={`w-24 min-w-24 border-b border-r border-border p-0 align-middle ${props.weekend ? "bg-muted/40" : ""}`}
      onDragOver={(e) => { if (props.canWrite) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); props.onDropRow(props.vehicleId, props.date, e.dataTransfer.getData("text/plain")); }}
    >
      <button
        type="button"
        draggable={!!row && props.canWrite}
        onDragStart={(e) => row && e.dataTransfer.setData("text/plain", JSON.stringify(row))}
        onClick={() => props.onOpen(props.vehicleId, props.date)}
        className="relative h-9 w-full cursor-pointer px-1 text-left leading-tight hover:bg-accent/40"
      >
        {(props.logistics || props.dupDriver) && (
          <span className="absolute right-0.5 top-0.5 flex gap-0.5">
            {props.logistics && <span title={`Logística: ${props.logistics}`}><Package className="h-3 w-3 text-primary" /></span>}
            {props.dupDriver && <span title={props.dupDriver}><AlertTriangle className="h-3 w-3 text-warning" /></span>}
          </span>
        )}
        {row ? (
          <>
            <div className="flex items-center gap-1 pr-6">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${props.bonusTone === "undefined" ? "bg-destructive" : props.bonusTone === "bonus" ? "bg-success" : "bg-muted-foreground/40"}`}
                title={props.bonusTone === "undefined" ? "Motorista a definir" : props.bonusTone === "bonus" ? "Com prêmio de motorista" : "Sem prêmio de motorista"}
              />
              <span className="truncate text-[10px] font-medium">{props.driverText}</span>
            </div>
            <div className="truncate text-[10px] uppercase text-muted-foreground" title={props.extrasTitle}>
              <span title="Km rodados no dia (ida e volta × viagens + fretes extras)">{Math.round(props.km)}km</span>{" "}
              {props.placeText}
              {props.extrasCount > 0 && <span className="font-semibold text-primary"> +{props.extrasCount}</span>}
            </div>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/60">—</span>
        )}
      </button>
    </td>
  );
});

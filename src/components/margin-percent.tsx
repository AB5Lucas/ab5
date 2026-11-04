import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MarginPercent({ value, margin }: { value: number | null; margin: number }) {
  const defined = value !== null && Number.isFinite(value) && !(margin < 0 && value >= 0);
  const label = defined ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—";
  return <Tooltip><TooltipTrigger asChild><span className={margin < 0 || !defined ? "text-destructive" : undefined}>{label}</span></TooltipTrigger>{!defined && <TooltipContent>Sem receita no período</TooltipContent>}</Tooltip>;
}
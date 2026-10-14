// Módulo Andaimes — localizações e helpers operacionais (sem valores financeiros)
export const LOCATIONS = [
  { key: "central", label: "Estoque central" },
  { key: "obra", label: "Em obras" },
  { key: "transito", label: "Em trânsito" },
  { key: "manutencao", label: "Em manutenção" },
  { key: "danificado", label: "Danificados" },
  { key: "retorno", label: "Pendências de retorno" },
] as const;
export type LocationKey = (typeof LOCATIONS)[number]["key"];
export const locLabel = (k: string) => LOCATIONS.find((l) => l.key === k)?.label ?? k;

export const INV_STATUS: Record<string, string> = { em_andamento: "Em andamento", finalizado: "Finalizado", cancelado: "Cancelado" };

/** Diferença = quantidade contada − quantidade no sistema */
export const invDiff = (counted: number | null | undefined, system: number) => (counted == null ? null : Number(counted) - Number(system));

// Módulo Andaimes — localizações e helpers operacionais (sem valores financeiros)
export const LOCATIONS = [
  { key: "central", label: "Estoque central (Pátio)" },
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

export const REQ_STATUS: Record<string, string> = {
  aberta: "Aberta", em_analise: "Em análise", aguardando_separacao: "Aguardando separação", em_separacao: "Em separação",
  parcialmente_separada: "Parcialmente separada", separada: "Separada", compra_necessaria: "Compra necessária",
  compra_realizada: "Compra realizada", em_transito: "Em trânsito", recebida: "Recebida", atendida: "Atendida", cancelada: "Cancelada",
};
export const PRIORITY: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
export const PURCHASE_STATUS: Record<string, string> = {
  compra_necessaria: "Compra necessária", compra_solicitada: "Compra solicitada", compra_realizada: "Compra realizada", recebido: "Material recebido",
};
export const ROM_STATUS: Record<string, string> = { rascunho: "Em conferência", em_transito: "Em trânsito", recebido: "Recebido na obra", retornado: "Retornado", cancelado: "Cancelado" };
export const romNumber = (n: number) => `ROM-${String(n).padStart(6, "0")}`;
/** Falta = solicitado − disponível (nunca negativa) */
export const shortage = (requested: number, available: number) => Math.max(0, Number(requested) - Number(available));
/** Status após concluir a separação */
export function separationStatus(lines: { requested: number; separated: number; available: number }[]) {
  if (lines.every((l) => l.separated >= l.requested)) return "separada";
  if (lines.some((l) => l.available < l.requested)) return "compra_necessaria";
  return "parcialmente_separada";
}
/** Unidades que saíram e não retornaram (nunca corrigido automaticamente) */
export const notReturned = (sent: number, ret: number[]) => Math.max(0, Number(sent) - ret.reduce((a, b) => a + Number(b), 0));

export const STRUCT_STATUS: Record<string, string> = {
  montagem: "Em montagem", liberado: "Liberado", aguardando_desmontagem: "Aguardando desmontagem", desmontagem: "Em desmontagem", desmontado: "Desmontado",
};
/** Vistoria: vencida após a data; a vencer em até 7 dias */
export function inspectionState(validUntil: string | null | undefined, today: string): "none" | "ok" | "expiring" | "expired" {
  if (!validUntil) return "none";
  if (validUntil < today) return "expired";
  const diff = (new Date(validUntil).getTime() - new Date(today).getTime()) / 86400000;
  return diff <= 7 ? "expiring" : "ok";
}
/** Depreciação linear por unidade, limitada ao valor de aquisição */
export function depreciation(acq: number, lifeMonths: number, acquiredAt: string | null | undefined, today: string) {
  if (!acquiredAt || !lifeMonths || acq <= 0) return 0;
  const [y1, m1] = acquiredAt.split("-").map(Number), [y2, m2] = today.split("-").map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1));
  return Math.min(acq, (acq / lifeMonths) * months);
}

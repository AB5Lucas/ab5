/**
 * Solicitações de compra (SC): listas e cores da planilha CONTROLE DE SOLICITAÇÕES (aba LISTAS) e do modelo
 * FR-CPS-SC-(requisitante)-XXX.xlsm. Regras puras, sem acesso ao banco.
 */
export const SC_SYSTEMS = ["PLANILHA", "TOTVS"] as const;

export const SC_CATEGORIES = [
  "EPI", "Consumo", "Ferragens", "Ferramentas/Equipamentos", "Frete", "Informática", "Limpeza", "Manutenção de Equipamentos",
  "Manutenção Predial", "Manutenção Veicular", "Matéria Prima", "Obra", "Papelaria", "Prestações de Serviços", "Retrabalho", "Uniforme",
] as const;

export const SC_NATURES = ["PROGRAMADA", "EMERGENCIAL", "REPOSIÇÃO", "PONTUAL", "PARADA", "CONTRATO/PEDIDO DO CLIENTE"] as const;

/** Prioridade com as cores da planilha (0 vermelho, 1 laranja, 2 amarelo, 3 verde). */
export const SC_PRIORITIES = [
  { value: "0 - EMERGÊNCIA", cls: "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-100" },
  { value: "1 - ALTA", cls: "bg-orange-200 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100" },
  { value: "2 - MÉDIA", cls: "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/50 dark:text-yellow-100" },
  { value: "3 - BAIXA", cls: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100" },
] as const;

/** Status da SC (coluna AA da aba LISTAS), com as cores da planilha. */
export const SC_STATUSES = [
  { value: "EM PREPARAÇÃO", cls: "bg-muted text-muted-foreground" },
  { value: "SOLICITAÇÃO ENVIADA", cls: "bg-cyan-100 text-cyan-950 dark:bg-cyan-900/50 dark:text-cyan-100" },
  { value: "SOLICITAÇÃO RECEBIDA", cls: "bg-sky-100 text-sky-950 dark:bg-sky-900/50 dark:text-sky-100" },
  { value: "EM ANÁLISE", cls: "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/50 dark:text-yellow-100" },
  { value: "SOLICITAÇÃO COM PENDÊNCIAS", cls: "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-100" },
  { value: "COTAR", cls: "bg-violet-100 text-violet-950 dark:bg-violet-900/50 dark:text-violet-100" },
  { value: "EM ANDAMENTO", cls: "bg-blue-900 text-white" },
  { value: "APROVAÇÃO PENDENTE", cls: "bg-orange-200 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100" },
  { value: "RECUSADA", cls: "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900" },
  { value: "APROVADA", cls: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100" },
  { value: "COMPRA PARCIAL", cls: "bg-lime-200 text-lime-950 dark:bg-lime-900/60 dark:text-lime-100" },
  { value: "COMPRA EFETIVADA", cls: "bg-green-600 text-white" },
  { value: "ALMOXARIFADO", cls: "bg-teal-600 text-white" },
  { value: "CANCELADA", cls: "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900" },
] as const;

/** Status de cada item (coluna STATUS do modelo FR-CPS-SC). */
export const SC_ITEM_STATUSES = ["SOLICITAÇÃO ENVIADA", "EM ANÁLISE", "COTAR", "COTANDO", "APROVAÇÃO PENDENTE", "RECUSADO", "APROVADO", "COMPRADO", "ALMOXARIFADO"] as const;

export const SC_UNITS = ["UN", "PC", "CX", "KG", "M", "M²", "M³", "L", "PAR", "JG", "RL", "SC", "GL", "TB", "KIT", "SERV"] as const;

export const priorityClass = (p: string | null | undefined) => SC_PRIORITIES.find((x) => x.value === p)?.cls ?? "bg-muted text-muted-foreground";
export const statusClass = (s: string | null | undefined) => SC_STATUSES.find((x) => x.value === s)?.cls ?? "bg-muted text-muted-foreground";

/** Bolinha de status antes do número (cor forte da mesma família da etiqueta). */
const STATUS_DOT: Record<string, string> = {
  "EM PREPARAÇÃO": "bg-zinc-400", "SOLICITAÇÃO ENVIADA": "bg-cyan-500", "SOLICITAÇÃO RECEBIDA": "bg-sky-500", "EM ANÁLISE": "bg-yellow-400",
  "SOLICITAÇÃO COM PENDÊNCIAS": "bg-red-500", COTAR: "bg-violet-500", "EM ANDAMENTO": "bg-blue-900", "APROVAÇÃO PENDENTE": "bg-orange-500",
  RECUSADA: "bg-zinc-900 dark:bg-zinc-200", APROVADA: "bg-emerald-500", "COMPRA PARCIAL": "bg-lime-500", "COMPRA EFETIVADA": "bg-green-600",
  ALMOXARIFADO: "bg-teal-600", CANCELADA: "bg-zinc-900 dark:bg-zinc-200",
};
export const statusDot = (s: string | null | undefined) => STATUS_DOT[s ?? ""] ?? "bg-zinc-400";

/** Etapa do fluxo: rascunho (com o solicitante) → autorização ("aprovacao" no banco) → compras. */
export type ScStage = "rascunho" | "aprovacao" | "compras" | "cancelada";
export const STAGE_LABEL: Record<ScStage, string> = { rascunho: "Com o solicitante", aprovacao: "Com o autorizante", compras: "Em compras", cancelada: "Cancelada" };

/**
 * Controle de prazo (como a coluna CONTROLE DE PRAZO da planilha): não enviado ainda; compra efetivada ou
 * almoxarifado compara a data do status com o prazo; nos demais, hoje com o prazo.
 */
export type Deadline = { label: "NÃO ENVIADO" | "SEM PRAZO" | "DENTRO DO PRAZO" | "NO LIMITE" | "FORA DO PRAZO"; cls: string };
export function deadlineControl(r: { sent_at: string | null; due_date: string | null; status: string; status_at: string }, today: string): Deadline {
  if (!r.sent_at) return { label: "NÃO ENVIADO", cls: "text-muted-foreground" };
  if (!r.due_date) return { label: "SEM PRAZO", cls: "text-muted-foreground" };
  const ref = r.status === "COMPRA EFETIVADA" || r.status === "ALMOXARIFADO" ? r.status_at : today;
  if (ref < r.due_date) return { label: "DENTRO DO PRAZO", cls: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100" };
  if (ref === r.due_date) return { label: "NO LIMITE", cls: "bg-orange-200 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100" };
  return { label: "FORA DO PRAZO", cls: "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-100" };
}

/** Verba obrigatória (por item ou total), menos quando a natureza é PROGRAMADA. */
export function budgetMissing(nature: string | null, totalBudget: number | null | undefined, itemBudgets: (number | null | undefined)[]) {
  if ((nature ?? "").toUpperCase() === "PROGRAMADA") return false;
  if (Number(totalBudget ?? 0) > 0) return false;
  return !itemBudgets.length || itemBudgets.some((b) => !(Number(b ?? 0) > 0));
}

export const deliveryLabel = (r: { delivery_kind: string; delivery_place: string | null }, clientName: string | null | undefined) =>
  r.delivery_kind === "ab5" ? "AB5" : r.delivery_kind === "cliente" ? clientName ?? "Cliente" : r.delivery_place ?? "—";

export const brDate = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Observador fixo em toda SC (o banco também garante, purchase_fixed_observers): Marcelo Barrella. */
export const FIXED_OBSERVERS = ["cfd87887-421e-48f6-871c-a229e8634700"];

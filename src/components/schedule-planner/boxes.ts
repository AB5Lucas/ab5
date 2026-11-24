import { toast } from "sonner";
import type { AsoStatus, IntegrationStatus } from "@/lib/scheduling";

/** Constantes e utilitários dos quadros da Programação (caixas de situação, mensagens, níveis de escalação). */
export type Level = "ok" | "warn" | "block" | "busy";

export type Evaluation = {
  level: Level;
  reasons: string[];
  integration: IntegrationStatus | null;
  aso: AsoStatus | null;
  reqIssues: number;
  reqBlocked: boolean;
  fit: boolean;
  /** Indisponível por ausência/compromisso/caixa: aparece como ocupado, mas não pode ser alocado. */
  hardBlock?: boolean;
};

export type DragPayload = { collaboratorId: string; allocationId: string | null; entryId?: string | null };

/** Caixas de situação que podem ser exibidas junto aos cards de obra. */
export const STATUS_BOXES = [
  // Compromissos logo após as obras
  { key: "integracao", label: "INTEGRAÇÃO" },
  { key: "aso", label: "ASO" },
  { key: "treinamento", label: "TREINAMENTO" },
  // Depois ausências e situações
  { key: "folga", label: "FOLGAS" },
  { key: "atestado", label: "ATESTADO" },
  { key: "ferias", label: "FÉRIAS" },
  { key: "medico", label: "MÉDICO" },
  { key: "afastado", label: "AFASTADO" },
  { key: "falta", label: "FALTA" },
  { key: "interjornada", label: "INTERJORNADA" },
  { key: "licenca", label: "LICENÇA" },
  { key: "abono", label: "ABONO" },
  { key: "personalizada", label: "PERSONALIZADA" },
] as const;

export const BOX_LABEL: Record<string, string> = Object.fromEntries(STATUS_BOXES.map((b) => [b.key, b.label]));

/** Caixas alimentadas automaticamente (ausências e agendamentos) — não aparecem no menu. */
export const AUTO_BOX_KEYS = ["aso", "treinamento", "integracao", "ferias"];

/** Caixas que o usuário liga manualmente pelo botão "Caixas". */
export const MANUAL_BOXES = STATUS_BOXES.filter((b) => !AUTO_BOX_KEYS.includes(b.key)).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

/** Ausências cadastradas → caixa correspondente (alimentada automaticamente). */
export const ABSENCE_BOX: Record<string, string> = {
  "Férias": "ferias",
  "Atestado": "atestado",
  "Folga": "folga",
};
export const BOXES_STORAGE_KEY = "planner-status-boxes";

/** Sábado ou domingo: o dia começa sem nenhum cliente marcado (sem herança da sexta). */
export function isWeekendDate(iso: string) {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6;
}

/** Tipo de agendamento → caixa correspondente na programação. */
export const APPOINTMENT_BOX: Record<string, string> = {
  aso: "aso",
  treinamento: "treinamento",
  integracao: "integracao",
};

/** Prefixo das caixas de integração (uma por cliente). */
export const INTEGRATION_PREFIX = "integracao:";

/** Nome do cliente da caixa de integração. */
export function integrationClientOf(boxKey: string) {
  return boxKey.slice(INTEGRATION_PREFIX.length);
}

/** Rótulo de uma caixa (inclui as dinâmicas de integração por cliente). */
export function boxLabelOf(boxKey: string): string {
  if (boxKey.startsWith(INTEGRATION_PREFIX))
    return `INTEGRAÇÃO - ${integrationClientOf(boxKey).toUpperCase()}`;
  return BOX_LABEL[boxKey] ?? boxKey;
}

export type AppointmentRow = {
  type: string;
  collaborator_id: string;
  scheduled_time?: string | null;
  notes?: string | null;
  trainings: { name: string } | null;
  clients: { name: string } | null;
};

/** Nome do cliente do agendamento de integração. */
export function appointmentClientName(a: AppointmentRow): string {
  return a.clients?.name ?? "—";
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "2026-09-16" → "Dia 16/09 - Quarta" */
export function dayLine(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `Dia ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} - ${wd}`;
}

/** "07:00:00" → "07h"; "07:30" → "07h30" */
export function hourLabel(time?: string | null): string {
  if (!time) return "";
  const [h, min] = time.split(":");
  return min && min !== "00" ? `${h}h${min}` : `${h}h`;
}

export const ASO_FOOTER = `👉ATENÇÃO👈

👉Lembre-se de fazer jejum de 12 horas para não alterar os resultados dos exames.

👉Solicitamos que após realização de exame periódico peçam à recepção da clínica uma declaração de comparecimento, constando data e o horário de chegada e saída, para fins de abono de horas.

👉Após o exame retornar a INDUSTRIA.`;

export const ASO_ADDRESS =
  "Av. Bandeirantes, 1.645, no piso superior do Boulevard Bandeiras, no Parque Cidade Nova.";

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Mensagem copiada!");
  } catch {
    toast.error("Não foi possível copiar a mensagem");
  }
}

/** Texto do box do compromisso agendado. */
export function appointmentLabel(a: AppointmentRow): string {
  if (a.type === "aso") return "Exame ASO";
  if (a.type === "treinamento") return `Treinamento - ${a.trainings?.name ?? "—"}`;
  return `Integração - ${appointmentClientName(a)}`;
}

/** Caixa do agendamento — integrações são separadas por cliente. */
export function appointmentBoxKey(a: AppointmentRow): string | null {
  if (a.type === "integracao") return `${INTEGRATION_PREFIX}${appointmentClientName(a)}`;
  return APPOINTMENT_BOX[a.type] ?? null;
}

/** Padrão de VT dos quadros de compromisso (null = quadro sem VT). */
export function vtBoxDefault(key: string): boolean | null {
  if (key === "aso" || key === "treinamento") return true;
  if (key === "integracao" || key.startsWith(INTEGRATION_PREFIX)) return false;
  if (key === "personalizada") return false;
  return null;
}

export const FILTERS = [
  { key: "allocated", label: "Já alocados" },
  { key: "unallocated", label: "Não alocados" },
  { key: "warn", label: "Com pendência" },
  { key: "blocked", label: "Bloqueados" },
  { key: "pj_int", label: "Intermitentes/PJs" },
] as const;


/** Contratos ocultos por padrão na lista lateral. */
export const HIDDEN_CONTRACTS = ["pj", "intermitente"];

export type FilterKey = (typeof FILTERS)[number]["key"];

export const LEVEL_DOT: Record<Level, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  block: "bg-destructive",
  busy: "bg-sky-500",
};

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "Apto",
  warn: "Pendência",
  block: "Bloqueado",
  busy: "Alocado",
};

/**
 * Validade e situação dos documentos do colaborador (ASO, integração, treinamento), num lugar só.
 * Usado por Conferência, ASOs, Integrações, Treinamentos, Liberação por cliente e pela Programação.
 * Regras: ASO e integração valem 12 meses; treinamento vale a validade do catálogo (sem validade = não vence);
 * vencimento = realização + meses − 1 dia; "a vencer" = vence em até 30 dias.
 */

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Vencimento = realização + validade (meses) − 1 dia.
 * Ex.: 15/01/2026 + 12 meses → 14/01/2027. Válido até o próprio dia do vencimento.
 */
export const expiryFrom = (iso: string, months: number) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + months, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};

export const ASO_VALIDITY_MONTHS = 12;
export const INTEGRATION_VALIDITY_MONTHS = 12;
/** Dias de antecedência para "próximo do vencimento". */
export const DOC_WARN_DAYS = 30;

export const asoExpiry = (examDate: string) => expiryFrom(examDate, ASO_VALIDITY_MONTHS);
export const integrationExpiry = (date: string) => expiryFrom(date, INTEGRATION_VALIDITY_MONTHS);
/** Treinamento sem validade no catálogo (0/nulo) não vence. */
export const trainingExpiry = (date: string, months: number | null | undefined) => (months ? expiryFrom(date, months) : null);

export type DocStatus = "valid" | "expiring" | "expired";

/** Situação pelo vencimento: sem vencimento = válido (não vence). */
export function docStatus(expires: string | null | undefined, today: string, warnDays = DOC_WARN_DAYS): DocStatus {
  if (!expires) return "valid";
  if (expires < today) return "expired";
  if (expires <= addDays(today, warnDays)) return "expiring";
  return "valid";
}

/** Registro de vencimento mais distante por chave (sem vencimento ganha: não vence). */
export function latestByKey<T extends { expires_at: string | null }>(list: T[], key: (x: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of list) {
    const k = key(x);
    const cur = m.get(k);
    if (!cur || (x.expires_at ?? "9999-12-31") > (cur.expires_at ?? "9999-12-31")) m.set(k, x);
  }
  return m;
}

/** Situação de um documento numa célula da Liberação por cliente. */
export type CellStatus = DocStatus | "missing" | "scheduled" | "conference";
export const CELL_LABEL: Record<CellStatus, string> = {
  valid: "Válido",
  expiring: "Vence em 30 dias",
  expired: "Vencido",
  missing: "Ausente",
  scheduled: "Agendado",
  conference: "Na Conferência",
};
/** Agendado/na Conferência só contam quando o documento não está válido. */
export function cellStatus(opts: { has: boolean; expires: string | null | undefined; today: string; scheduled?: boolean; conference?: boolean }): CellStatus {
  const st: CellStatus = opts.has ? docStatus(opts.expires, opts.today) : "missing";
  if (st === "valid") return st;
  if (opts.conference) return "conference";
  if (opts.scheduled) return "scheduled";
  return st;
}

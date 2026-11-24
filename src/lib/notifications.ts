/**
 * Notificações: regras puras (sem banco). O nível do prazo é o mesmo de purchase_deadline_level (migração 0175).
 * Datas em AAAA-MM-DD já no fuso de Brasília.
 */

export type DeadlineLevel = "antecedencia" | "urgente" | "atrasado";
export type DeadlineSettings = { advanceDays: number; urgentDays: number };
export const DEFAULT_DEADLINE_SETTINGS: DeadlineSettings = { advanceDays: 5, urgentDays: 2 };

export const DEADLINE_LEVEL_LABEL: Record<DeadlineLevel, string> = { antecedencia: "Antecedência", urgente: "Urgente", atrasado: "Atrasado" };

const dayNumber = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
/** Dias do hoje até o prazo (negativo = vencido). */
export const daysUntil = (due: string, today: string) => dayNumber(due) - dayNumber(today);

/** Atrasado (prazo passou) > Urgente (até urgentDays, inclusive o dia do prazo) > Antecedência (até advanceDays) > nada. */
export function deadlineLevel(due: string | null | undefined, today: string, s: DeadlineSettings = DEFAULT_DEADLINE_SETTINGS): DeadlineLevel | null {
  if (!due) return null;
  const d = daysUntil(due, today);
  if (d < 0) return "atrasado";
  if (d <= s.urgentDays) return "urgente";
  if (d <= s.advanceDays) return "antecedencia";
  return null;
}

/** Configuração global válida: antecedência 1–60, urgência 0–30 e menor que a antecedência. */
export function validateDeadlineSettings(s: DeadlineSettings): string | null {
  if (!Number.isInteger(s.advanceDays) || s.advanceDays < 1 || s.advanceDays > 60) return "Antecedência deve ser de 1 a 60 dias";
  if (!Number.isInteger(s.urgentDays) || s.urgentDays < 0 || s.urgentDays > 30) return "Urgente deve ser de 0 a 30 dias";
  if (s.urgentDays >= s.advanceDays) return "Urgente deve ser menor que a antecedência";
  return null;
}

/** Hoje (AAAA-MM-DD) no fuso de Brasília. */
export function todayBrasilia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Data e hora de Brasília para exibir (dd/mm/aaaa hh:mm). */
export function formatBrasilia(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

// ---------------------------------------------------------------- Preferências

export type NotificationPrefs = {
  push_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  whatsapp_phone: string | null;
  digest_enabled: boolean;
  digest_days: number[];
  digest_time: string;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  push_enabled: false, email_enabled: true, whatsapp_enabled: false, whatsapp_phone: null,
  digest_enabled: false, digest_days: [1, 2, 3, 4, 5], digest_time: "07:30",
};

export const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** Telefone para WhatsApp no formato internacional só com dígitos (55 + DDD + número); null se inválido. */
export function normalizeWhatsApp(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

/** Erro da preferência (o banco também barra sem canal: notification_prefs_one_channel); null = ok. */
export function validatePrefs(p: NotificationPrefs, fallbackPhone?: string | null): string | null {
  if (!p.push_enabled && !p.email_enabled && !p.whatsapp_enabled) return "Ligue pelo menos um canal além do aplicativo (Push, E-mail ou WhatsApp)";
  const phone = (p.whatsapp_phone ?? "").trim() || (fallbackPhone ?? "");
  if ((p.whatsapp_enabled || p.digest_enabled) && !normalizeWhatsApp(phone)) return "Informe um WhatsApp válido com DDD";
  if (p.whatsapp_phone?.trim() && !normalizeWhatsApp(p.whatsapp_phone)) return "WhatsApp inválido: use DDD + número";
  if (p.digest_enabled && !p.digest_days.length) return "Escolha pelo menos um dia para o resumo diário";
  if (p.digest_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Dia da semana inválido";
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(p.digest_time)) return "Horário do resumo inválido";
  return null;
}

// ---------------------------------------------------------------- Resumo diário

export type DigestRow = { role: "solicitante" | "validador" | "comprador"; id: string; number: string; due_date: string | null; status: string; client_name: string | null };

const SECTION: Record<DigestRow["role"], string> = {
  solicitante: "Devolvidas para você corrigir",
  validador: "Aguardando sua validação",
  comprador: "Aguardando compra",
};
const brDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MAX_LINES = 8;

function dueText(due: string | null, today: string): string {
  if (!due) return "sem prazo";
  const d = daysUntil(due, today);
  if (d < 0) return `ATRASADA (${brDay(due)})`;
  if (d === 0) return "vence hoje";
  if (d === 1) return "vence amanhã";
  return `prazo ${brDay(due)}`;
}

/**
 * Texto curto do resumo diário (WhatsApp), por responsabilidade; null quando não há nada (não envia vazio).
 * Ordem: mais urgente primeiro; no fim, atrasadas e próximas do vencimento.
 */
export function buildDigest(rows: DigestRow[], today: string, opts: { name?: string | null; settings?: DeadlineSettings } = {}): string | null {
  const uniq = [...new Map(rows.map((r) => [`${r.role}:${r.id}`, r])).values()];
  if (!uniq.length) return null;
  const s = opts.settings ?? DEFAULT_DEADLINE_SETTINGS;
  const byDue = (a: DigestRow, b: DigestRow) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.number.localeCompare(b.number);
  const first = (opts.name ?? "").trim().split(/\s+/)[0];
  const out: string[] = [`*AB5 Hub · Resumo de compras (${brDay(today)})*`];
  if (first) out.push(`Olá, ${first}!`);
  for (const role of ["solicitante", "validador", "comprador"] as const) {
    const list = uniq.filter((r) => r.role === role).sort(byDue);
    if (!list.length) continue;
    out.push("", `*${SECTION[role]} (${list.length})*`);
    for (const r of list.slice(0, MAX_LINES)) out.push(`• ${[r.number, r.client_name, dueText(r.due_date, today)].filter(Boolean).join(" · ")}`);
    if (list.length > MAX_LINES) out.push(`… e mais ${list.length - MAX_LINES}`);
  }
  const ids = (lvl: (r: DigestRow) => boolean) => [...new Set(uniq.filter(lvl).sort(byDue).map((r) => r.number))];
  const late = ids((r) => deadlineLevel(r.due_date, today, s) === "atrasado");
  const soon = ids((r) => { const l = deadlineLevel(r.due_date, today, s); return l === "urgente" || l === "antecedencia"; });
  if (late.length || soon.length) out.push("");
  if (late.length) out.push(`Atrasadas (${late.length}): ${late.slice(0, MAX_LINES).join(", ")}${late.length > MAX_LINES ? "…" : ""}`);
  if (soon.length) out.push(`Próximas do vencimento (${soon.length}): ${soon.slice(0, MAX_LINES).join(", ")}${soon.length > MAX_LINES ? "…" : ""}`);
  return out.join("\n");
}

/** Texto de uma notificação para WhatsApp/e-mail simples. */
export function notificationText(n: { title: string; body: string | null; ref: string | null }, url: string | null): string {
  return [`*AB5 Hub* · ${n.title}`, n.ref, n.body, url].filter(Boolean).join("\n");
}

/**
 * Quando um treinamento entra em "A vencer" (ou venceu), outros treinamentos da
 * mesma pessoa que vencem até 2 meses depois dele, mas que ainda faltam mais de
 * 30 dias, são avisados para agendar tudo de uma vez.
 */
export const EXPIRING_DAYS = 30;
export const BATCH_MONTHS = 2;

type Rec = { id: string; collaborator_id: string; training_id: string; expires_at: string | null };

const dayMs = 86400000;
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
export function plusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Registro → outros treinamentos da pessoa que vencem logo depois e ainda não estão "A vencer". */
export function upcomingAlongside(records: Rec[], today: string, skip: (r: Rec) => boolean = () => false): Map<string, Rec[]> {
  // Só vale o registro mais recente de cada treinamento da pessoa.
  const latest = new Map<string, Rec>();
  for (const r of records) {
    if (!r.expires_at) continue;
    const k = `${r.collaborator_id}|${r.training_id}`;
    const cur = latest.get(k);
    if (!cur || (cur.expires_at ?? "") < r.expires_at) latest.set(k, r);
  }
  const byPerson = new Map<string, Rec[]>();
  for (const r of latest.values()) byPerson.set(r.collaborator_id, [...(byPerson.get(r.collaborator_id) ?? []), r]);
  const out = new Map<string, Rec[]>();
  for (const r of records) {
    if (!r.expires_at || daysUntil(r.expires_at, today) > EXPIRING_DAYS) continue;
    if (latest.get(`${r.collaborator_id}|${r.training_id}`)?.id !== r.id) continue; // registro antigo, já renovado
    const limit = plusMonths(r.expires_at, BATCH_MONTHS);
    const next = (byPerson.get(r.collaborator_id) ?? [])
      .filter((o) => o.training_id !== r.training_id && daysUntil(o.expires_at!, today) > EXPIRING_DAYS && o.expires_at! <= limit && !skip(o))
      .sort((a, b) => a.expires_at!.localeCompare(b.expires_at!));
    if (next.length) out.set(r.id, next);
  }
  return out;
}

import { supabase } from "@/integrations/supabase/client";

const DEFAULT_HOURS = 8;

const monthRange = (date: string) => {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return [`${date.slice(0, 7)}-01`, `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`] as const;
};

/** Horas trabalhadas por serviço no mês (RDO presente; escalado sem RDO = 8h). */
async function hoursByWork(workIds: string[], from: string, to: string) {
  const hours = new Map<string, number>(workIds.map((id) => [id, 0]));
  const [{ data: wf }, { data: scheds }] = await Promise.all([
    supabase.from("rdo_workforce").select("work_id, collaborator_id, report_date, present, worked_hours").in("work_id", workIds).gte("report_date", from).lte("report_date", to),
    supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", from).lte("schedule_date", to),
  ]);
  const rdo = new Map<string, any>((wf ?? []).map((r) => [`${r.collaborator_id}|${r.report_date}|${r.work_id}`, r]));
  const dateOf = new Map((scheds ?? []).map((s) => [s.id, s.schedule_date as string]));
  const seen = new Set<string>();
  const sIds = [...dateOf.keys()];
  for (let i = 0; i < sIds.length; i += 200) {
    const { data: al } = await supabase.from("daily_allocations").select("schedule_id, work_id, collaborator_id").in("schedule_id", sIds.slice(i, i + 200)).in("work_id", workIds);
    for (const a of al ?? []) {
      const k = `${a.collaborator_id}|${dateOf.get(a.schedule_id)}|${a.work_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const r = rdo.get(k);
      const h = r ? (r.present ? Number(r.worked_hours ?? DEFAULT_HOURS) : 0) : DEFAULT_HOURS;
      hours.set(a.work_id, (hours.get(a.work_id) ?? 0) + h);
    }
  }
  for (const [k, r] of rdo) {
    if (seen.has(k) || !r.present) continue;
    hours.set(r.work_id, (hours.get(r.work_id) ?? 0) + Number(r.worked_hours ?? 0));
  }
  return hours;
}

export function splitRows(amount: number, hours: Map<string, number>) {
  const total = [...hours.values()].reduce((a, b) => a + b, 0);
  const parts = [...hours.entries()].filter(([, h]) => h > 0);
  let rest = Math.round(amount * 100);
  return {
    total,
    parts: parts.map(([id, h], i) => {
      const cents = i === parts.length - 1 ? rest : Math.round((amount * 100 * h) / total);
      rest -= cents;
      return { work_id: id, hours: h, amount: cents / 100, pct: (h / total) * 100 };
    }),
  };
}

export const splitDesc = (note: string | null | undefined, pct: number, h: number) =>
  `${note ? note + " — " : ""}Rateio ${pct.toFixed(1).replace(".", ",")}% (${Math.round(h)}h)`;

/** Refaz os rateios de "Todos os serviços" do cliente pelas horas atuais do mês de cada lançamento. */
export async function resplitClient(workIds: string[]): Promise<boolean> {
  if (!workIds.length) return false;
  // Compras são recalculadas exclusivamente pela sincronização, preservando item e vínculo do CC.
  const { data: entries } = await supabase.from("work_entries").select("id, work_id, entry_date, category, amount, split_group, split_total, split_note").in("work_id", workIds).not("split_group", "is", null).is("purchase_cc_id", null);
  const groups = new Map<string, any[]>();
  for (const e of entries ?? []) groups.set(e.split_group!, [...(groups.get(e.split_group!) ?? []), e]);
  let changed = false;
  for (const [gid, rows] of groups) {
    const f = rows[0];
    const [from, to] = monthRange(f.entry_date);
    const hours = await hoursByWork(workIds, from, to);
    const amount = Number(f.split_total ?? rows.reduce((a, r) => a + Number(r.amount), 0));
    const { total, parts } = splitRows(amount, hours);
    if (!total) continue;
    const cur = new Map(rows.map((r) => [r.work_id, Number(r.amount)]));
    const same = parts.length === rows.length && parts.every((p) => Math.abs((cur.get(p.work_id) ?? -1) - p.amount) < 0.01);
    if (same) continue;
    const ins = parts.map((p) => ({
      work_id: p.work_id, entry_date: f.entry_date, category: f.category, amount: p.amount,
      description: splitDesc(f.split_note, p.pct, p.hours), split_group: gid, split_total: amount, split_note: f.split_note,
    }));
    const { error } = await supabase.from("work_entries").insert(ins);
    if (error) continue;
    await supabase.from("work_entries").delete().in("id", rows.map((r) => r.id));
    changed = true;
  }
  return changed;
}

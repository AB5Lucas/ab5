// Ocorrências de ponto calculadas ao vivo dos RDOs (compartilhado pela página e pelo contador do menu).
import { supabase } from "@/integrations/supabase/client";
import { reasonLabel } from "@/lib/rdo";

export type Kind = "falta" | "atestado" | "atraso" | "saida" | "interjornada";
export const KIND_LABEL: Record<Kind, string> = {
  falta: "Falta",
  atestado: "Atestado",
  atraso: "Atraso",
  saida: "Saída antecipada",
  interjornada: "Interjornada",
};
/** Tolerância (minutos) antes de considerar atraso/saída antecipada. */
export const TOLERANCE = 10;

export const toMin = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "—");

export type Occ = {
  key: string;
  wfId: string;
  kind: Kind;
  date: string;
  reg: string;
  name: string;
  client: string;
  service: string;
  reason: string;
  responsible: string;
  rdoNumber: number | null;
  wf: any;
  expected: { entry: string | null; exit: string | null };
};

export type TimeclockData = { wf: any[]; adj: any[]; shifts: any[] };

export async function fetchTimeclockData(from: string, to: string): Promise<TimeclockData> {
  const out: any[] = [];
  for (let i = 0; ; i += 1000) {
    let q = supabase
      .from("rdo_workforce")
      .select(
        "id, report_date, present, entry_time, exit_time, reported_reason, reported_note, final_classification, collaborators(full_name, registration_number, shift_id), rdos!inner(number, shift, responsible_name, works(name, entry_time, exit_time, exit_time_weekend, clients(name)))",
      )
      .order("report_date", { ascending: false })
      .range(i, i + 999);
    if (f.from) q = q.gte("report_date", f.from);
    if (f.to) q = q.lte("report_date", f.to);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: adj, error } = await supabase.from("timeclock_adjustments").select("rdo_workforce_id, kind, status, treated_at");
  if (error) throw error;
  const { data: shifts } = await supabase.from("work_shifts").select("id, is_default, schedule");
  return { wf: out, adj: adj ?? [], shifts: shifts ?? [] };
},
}

export function computeOccurrences(data: TimeclockData | undefined) {
  const occs: Occ[] = [];
  const treated = new Map<string, string>();
  const shiftMap = new Map<string, any>();
  for (const s of data?.shifts ?? []) if (!s.is_default) shiftMap.set(s.id, s.schedule ?? {});
  for (const a of data?.adj ?? []) if (a.status === "tratado") treated.set(`${a.rdo_workforce_id}|${a.kind}`, a.treated_at);
  for (const w of data?.wf ?? []) {
    const rdo = w.rdos;
    const work = rdo?.works;
    const dow = new Date(w.report_date + "T12:00:00").getDay();
    // Sexta, sábado e domingo: saída padrão reduzida (16h).
    const weekend = [0, 5, 6].includes(dow);
    // Colaborador em turno próprio (fora do Padrão): o horário previsto vem do turno dele.
    const own = w.collaborators?.shift_id ? shiftMap.get(w.collaborators.shift_id) : undefined;
    const ownDay = own ? own[String(dow)] : undefined;
    let night = rdo?.shift === "night" || rdo?.shift === "noturno";
    let expEntry: string | null = night ? "21:30" : work?.entry_time ?? null;
    let expExit: string | null = night ? "05:30" : (weekend && work?.exit_time_weekend) || work?.exit_time || null;
    if (own) {
      expEntry = ownDay?.start ?? null;
      expExit = ownDay?.end ?? null;
      night = !!ownDay && (toMin(ownDay.end) ?? 0) < (toMin(ownDay.start) ?? 0);
    }
    const base = {
      wfId: w.id,
      date: w.report_date,
      reg: w.collaborators?.registration_number ?? "",
      name: w.collaborators?.full_name ?? "—",
      client: work?.clients?.name ?? "—",
      service: work?.name ?? "—",
      responsible: rdo?.responsible_name ?? "—",
      rdoNumber: rdo?.number ?? null,
      wf: w,
      expected: { entry: expEntry, exit: expExit },
    };
    const add = (kind: Kind, reason: string) => occs.push({ ...base, key: `${w.id}|${kind}`, kind, reason });
    const cls = w.final_classification ?? w.reported_reason;
    const note = w.reported_note ? ` — ${w.reported_note}` : "";
    if (!w.present) {
      if (cls === "atestado" || cls === "medico") add("atestado", reasonLabel(w.reported_reason, w.reported_note) + note);
      else if (cls === "interjornada") add("interjornada", reasonLabel(w.reported_reason, w.reported_note) + note);
      else if (cls === "falta" || !cls || cls === "outro") add("falta", cls ? reasonLabel(w.reported_reason, w.reported_note) + note : "Ausente no RDO");
      continue;
    }
    const e = toMin(w.entry_time), ee = toMin(expEntry);
    {
      // Cumpriu a carga do dia (ex.: 05:00–15:00 no lugar de 07:00–17:00): não é atraso nem saída antecipada.
      const xs = toMin(w.exit_time), xe = toMin(expExit);
      if (e !== null && ee !== null && xs !== null && xe !== null) {
        const worked = (xs - e + 1440) % 1440, expected = (xe - ee + 1440) % 1440;
        if (expected > 0 && worked >= expected) continue;
      }
    }
    if (e !== null && ee !== null && e - ee > TOLERANCE && !(night && e < 12 * 60))
      add("atraso", `Entrada ${hhmm(w.entry_time)} (previsto ${hhmm(expEntry)})`);
    let x = toMin(w.exit_time), xx = toMin(expExit);
    if (x !== null && xx !== null) {
      if (night) { if (x < 12 * 60) x += 1440; if (xx < 12 * 60) xx += 1440; }
      if (xx - x > TOLERANCE) add("saida", `Saída ${hhmm(w.exit_time)} (previsto ${hhmm(expExit)})`);
    }
  }
  return { occs, treated };
}

/** Início padrão do período da página (dia 1 do mês atual). */
export const timeclockDefaultFrom = () => new Date().toISOString().slice(0, 8) + "01";

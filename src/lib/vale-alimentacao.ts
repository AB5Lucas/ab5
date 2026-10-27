/** Vale Alimentação: regras de desconto a partir das planilhas do ponto (Justificativa + Atraso). */
export type VASettings = {
  base_value: number; tolerance_min: number; pct1: number; pct2: number; pct3: number;
  unjustified_reasons: string[]; justified_reasons: string[]; abono_reasons: string[];
};
export type JustRow = { date: string; reg: string; name: string; reason: string };
export type PunchRow = { date: string; name: string; punches: string[]; discountMin: number; lateMin: number; earlyMin: number };
export type VAPerson = { id: string; reg: string; name: string };
export type VAEvent = { date: string; kind: "injustificada" | "justificada" | "atraso"; reason: string; detail: string };
export type VALine = VAPerson & { unjust: number; just: number; late: number; pct: number; value: number; events: VAEvent[] };

const pad = (n: number) => String(n).padStart(2, "0");
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** Competência "2026-09" = 26/08/2026 a 25/09/2026. */
export function vaPeriod(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return { from: `${py}-${pad(pm)}-26`, to: `${y}-${pad(m)}-25`, py, pm, y, m };
}
/** Pasta e arquivos do mês no OneDrive (ano e mês acompanham a competência). */
export function vaPaths(ym: string) {
  const { py, pm, y, m } = vaPeriod(ym);
  const folder = `RH/01 DEPARTAMENTO PESSOAL/01  FOPAG/00 APONTAMENTOS/Fechamento Mensal/${y}/${pad(m)}${y}/VA`;
  return { folder, atraso: "Atraso.xlsx", justificativa: `Justificativa 26_${pad(pm)}_${py} ate 25_${pad(m)}_${y}.xlsx` };
}

export function discountPct(count: number, s: Pick<VASettings, "pct1" | "pct2" | "pct3">) {
  if (count <= 0) return 0;
  if (count === 1) return s.pct1;
  if (count === 2) return s.pct2;
  return s.pct3;
}

const hm = (m: number) => `${Math.floor(m / 60)}h${pad(Math.round(m % 60))}`;

export function computeVA(people: VAPerson[], just: JustRow[], punches: PunchRow[], s: VASettings): VALine[] {
  const un = new Set(s.unjustified_reasons.map(norm)), ju = new Set(s.justified_reasons.map(norm)), ab = new Set(s.abono_reasons.map(norm));
  const byReg = new Map(people.map((p) => [p.reg.replace(/^0+/, ""), p]));
  const byName = new Map(people.map((p) => [norm(p.name), p]));
  const events = new Map<string, VAEvent[]>();
  const dayHasJust = new Set<string>();
  const push = (id: string, e: VAEvent) => events.set(id, [...(events.get(id) ?? []), e]);
  for (const r of just) {
    const p = byReg.get(String(r.reg).replace(/^0+/, "")) ?? byName.get(norm(r.name));
    if (!p) continue;
    const reason = norm(r.reason ?? "");
    if (ju.has(reason) || un.has(reason) || ab.has(reason)) dayHasJust.add(`${p.id}|${r.date}`);
    if (un.has(reason)) push(p.id, { date: r.date, kind: "injustificada", reason: r.reason, detail: "Falta injustificada" });
    else if (ju.has(reason)) push(p.id, { date: r.date, kind: "justificada", reason: r.reason, detail: r.reason });
  }
  const lateDays = new Set<string>();
  for (const r of punches) {
    const p = byName.get(norm(r.name));
    if (!p) continue;
    const dow = new Date(`${r.date}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!(r.discountMin > 0)) continue;
    if (r.lateMin < s.tolerance_min && r.earlyMin < s.tolerance_min) continue;
    const k = `${p.id}|${r.date}`;
    if (dayHasJust.has(k) || lateDays.has(k)) continue;
    lateDays.add(k);
    const parts = [r.lateMin >= s.tolerance_min ? `Atraso ${hm(r.lateMin)}` : "", r.earlyMin >= s.tolerance_min ? `Saída antecipada ${hm(r.earlyMin)}` : ""].filter(Boolean);
    push(p.id, { date: r.date, kind: "atraso", reason: parts.join(" · "), detail: `Marcações: ${r.punches.filter(Boolean).join(" ") || "—"} · Desconto ${hm(r.discountMin)}` });
  }
  return people.map((p) => {
    const ev = (events.get(p.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const unjust = ev.filter((e) => e.kind === "injustificada").length;
    const justN = ev.filter((e) => e.kind === "justificada").length;
    const late = ev.filter((e) => e.kind === "atraso").length;
    const pct = unjust > 0 ? 100 : discountPct(justN + late, s);
    return { ...p, unjust, just: justN, late, pct, value: Math.round(s.base_value * (100 - pct)) / 100, events: ev };
  });
}

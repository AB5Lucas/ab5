/**
 * Prêmio Motorista — regra única (Fechamento, Resultados/Financeiro e tela Benefícios › Prêmio Motorista).
 *
 * Cada linha de vehicle_schedules tem o frete principal (client_id/work_id/driver_id/km) e os fretes extras
 * (extra_client_ids[i], extra_work_ids[i], extra_driver_ids[i], extra_places[i]); o km dos extras é extra_km
 * dividido igualmente entre eles (mesma divisão da Frota).
 *
 * Por motorista e dia:
 *  - entram os fretes que ele dirige (principal ou extra) com direito ao prêmio (o chamador decide: botão
 *    Prêmio de Motorista da linha ou transporte montado, ausência, PJ);
 *  - não entram Manutenção/Revisão, Externo, Indústria com local digitado (viagem fora);
 *  - km do dia = soma do km de ida de cada frete (km de vehicle_schedules é o km de ida do cliente);
 *  - valor do dia = soma das faixas diárias em que o km do dia cai; faixa "fixo mensal" entra uma vez por motorista
 *    no período (só no Fechamento/tela; os Resultados não rateiam o fixo mensal).
 * Um prêmio por motorista por dia, mesmo dirigindo vários veículos ou fazendo vários fretes.
 */
export type BonusSchedule = {
  schedule_date: string;
  driver_id: string | null;
  client_id: string | null;
  work_id?: string | null | undefined;
  driver_bonus: boolean | null;
  km: number | string | null;
  trips?: number | null | undefined;
  extra_km?: number | string | null | undefined;
  extra_client_ids?: string[] | null | undefined;
  extra_driver_ids?: string[] | null | undefined;
  extra_places?: string[] | null | undefined;
  extra_work_ids?: string[] | null | undefined;
  is_external?: boolean | null | undefined;
  is_maintenance?: boolean | null | undefined;
  external_place?: string | null | undefined;
  is_suzano_local?: boolean | null | undefined;
};

export type BonusFreight<S extends BonusSchedule = BonusSchedule> = {
  driverId: string;
  date: string;
  clientId: string | null;
  workId: string | null;
  /** Km de ida do frete. */
  km: number;
  /** 0 = frete principal; 1.. = fretes extras na ordem de extra_client_ids. */
  index: number;
  schedule: S;
};

export type BonusRule = { id: string; amount: number | string; minimum_distance: number | string | null; maximum_distance: number | string | null; calculation_type: string };

/** Fretes da linha que podem dar prêmio (com motorista e sem viagem "fora"). */
export function scheduleFreights<S extends BonusSchedule>(s: S, isIndustry: (clientId: string | null | undefined) => boolean = () => false): BonusFreight<S>[] {
  const out: BonusFreight<S>[] = [];
  if (s.is_external || s.is_maintenance) return out;
  const date = String(s.schedule_date).slice(0, 10);
  if (s.driver_id && !s.external_place) {
    out.push({ driverId: s.driver_id, date, clientId: s.client_id, workId: s.work_id ?? null, km: Number(s.km ?? 0) || 0, index: 0, schedule: s });
  }
  const extras = s.extra_client_ids ?? [];
  const per = extras.length ? (Number(s.extra_km ?? 0) || 0) / extras.length : 0;
  extras.forEach((c, i) => {
    const d = s.extra_driver_ids?.[i];
    if (!d || !c) return;
    // Chaves especiais antigas da Transporte: Externo e Manutenção/Revisão nunca dão prêmio; Suzano Local = sem cliente.
    if (c === "__external__" || c === "__maintenance__" || c === "__revision__") return;
    // Indústria com local digitado = viagem fora: sem prêmio, como no frete principal.
    if ((s.extra_places?.[i] ?? "").trim() && isIndustry(c)) return;
    out.push({ driverId: d, date, clientId: c === "__suzano_local__" ? null : c, workId: s.extra_work_ids?.[i] || null, km: per, index: i + 1, schedule: s });
  });
  return out;
}

const inRule = (r: BonusRule, km: number) => km >= Number(r.minimum_distance ?? 0) && km <= (r.maximum_distance === null || r.maximum_distance === undefined ? Infinity : Number(r.maximum_distance));

/** Valor das faixas diárias para o km do dia. */
export function dailyBonusAmount(rules: BonusRule[], km: number) {
  return rules.filter((r) => r.calculation_type !== "fixed_monthly" && inRule(r, km)).reduce((s, r) => s + Number(r.amount), 0);
}

export type BonusDay<S extends BonusSchedule = BonusSchedule> = { driverId: string; date: string; km: number; amount: number; freights: BonusFreight<S>[] };

/**
 * Prêmio por motorista e dia. `eligible` filtra os fretes (prêmio ligado/transporte montado, ausência, PJ...).
 * `monthly` = inclui as faixas "fixo mensal" (uma vez por motorista, no primeiro dia em que a faixa vale).
 */
export function driverBonusDays<S extends BonusSchedule>(
  schedules: S[], rules: BonusRule[],
  opts: { eligible?: (f: BonusFreight<S>) => boolean; isIndustry?: (clientId: string | null | undefined) => boolean; monthly?: boolean } = {},
): BonusDay<S>[] {
  const by = new Map<string, BonusDay<S>>();
  for (const s of schedules) {
    for (const f of scheduleFreights(s, opts.isIndustry)) {
      if (opts.eligible && !opts.eligible(f)) continue;
      const k = `${f.driverId}|${f.date}`;
      const d = by.get(k) ?? { driverId: f.driverId, date: f.date, km: 0, amount: 0, freights: [] };
      d.km += f.km;
      d.freights.push(f);
      by.set(k, d);
    }
  }
  const days = [...by.values()].sort((a, b) => a.driverId.localeCompare(b.driverId) || a.date.localeCompare(b.date));
  const fixed = new Set<string>();
  for (const d of days) {
    d.amount = dailyBonusAmount(rules, d.km);
    if (!opts.monthly) continue;
    for (const r of rules) {
      if (r.calculation_type !== "fixed_monthly" || !inRule(r, d.km)) continue;
      const k = `${d.driverId}|${r.id}`;
      if (fixed.has(k)) continue;
      fixed.add(k);
      d.amount += Number(r.amount);
    }
  }
  return days;
}

/** Parte do prêmio do dia de cada frete: proporcional ao km (sem km, partes iguais). */
export function freightShares<S extends BonusSchedule>(day: BonusDay<S>): { freight: BonusFreight<S>; amount: number }[] {
  const n = day.freights.length;
  return day.freights.map((f) => ({ freight: f, amount: day.km > 0 ? (day.amount * f.km) / day.km : day.amount / n }));
}

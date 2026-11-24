import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { driverBonusDays, freightShares, scheduleFreights } = await import("./driver-bonus");
const { buildTransport, driverBonusFor, travelOnFor, vtBaseForDay, vtForDay } = await import("./transport-rules");
const { buildBase } = await import("./results-engine");

const RULES = [
  { id: "r13", amount: 13.05, minimum_distance: 0, maximum_distance: 69, calculation_type: "daily" },
  { id: "r18", amount: 18, minimum_distance: 70, maximum_distance: null, calculation_type: "daily" },
];
const row = (o: Record<string, unknown>) => ({ schedule_date: "2026-10-05", driver_id: null, client_id: "c1", driver_bonus: true, km: 0, ...o }) as any;

describe("Prêmio Motorista (driver-bonus)", () => {
  it("frete extra entra para o motorista do extra com extra_km dividido entre os extras", () => {
    const s = row({ driver_id: "ana", km: 40, extra_client_ids: ["c2", "c3"], extra_driver_ids: ["bia", ""], extra_km: 60 });
    const f = scheduleFreights(s);
    expect(f.map((x) => [x.driverId, x.clientId, x.km])).toEqual([["ana", "c1", 40], ["bia", "c2", 30]]);
  });
  it("um prêmio por motorista e dia, pela soma do km de ida dos fretes (principal + extra + outro veículo)", () => {
    const days = driverBonusDays([
      row({ driver_id: "ana", km: 40 }),
      row({ driver_id: "bia", km: 20, extra_client_ids: ["c2"], extra_driver_ids: ["ana"], extra_km: 35 }),
    ], RULES);
    const ana = days.find((d) => d.driverId === "ana")!;
    expect(ana.km).toBe(75);
    expect(ana.amount).toBe(18);
    expect(days.find((d) => d.driverId === "bia")!.amount).toBe(13.05);
    // Rateio do valor do dia entre os fretes pelo km
    const shares = freightShares(ana).map((x) => Math.round(x.amount * 100) / 100);
    expect(shares).toEqual([9.6, 8.4]);
  });
  it("Indústria com local, Externo e Manutenção não dão prêmio; frete extra Indústria com local também não", () => {
    const ind = new Set(["ind"]);
    const days = driverBonusDays([
      row({ driver_id: "ana", client_id: "ind", external_place: "CAMPINAS", km: 100 }),
      row({ driver_id: "bia", is_maintenance: true }),
      row({ driver_id: "caio", is_external: true }),
      row({ driver_id: "duda", km: 10, extra_client_ids: ["ind"], extra_driver_ids: ["eva"], extra_places: ["SP"], extra_km: 200 }),
      // Extra antigo "Externo" (chave especial) também não dá prêmio
      row({ driver_id: "duda", client_id: "ind", external_place: "PINHALENSE", km: 100, extra_client_ids: ["__external__"], extra_driver_ids: ["fabio"], extra_km: 100 }),
    ], RULES, { isIndustry: (c) => !!c && ind.has(c) });
    expect(days.map((d) => d.driverId)).toEqual(["duda"]);
  });
  it("elegibilidade pelo botão da linha ou transporte montado; fixo mensal uma vez por motorista", () => {
    const t = buildTransport([{ client_id: "c2", schedule_date: "2026-10-05", collaborator_id: "x", vehicle_schedule_id: "v" }]);
    const rows = [row({ driver_id: "ana", driver_bonus: false, km: 10, extra_client_ids: ["c2"], extra_driver_ids: ["ana"], extra_km: 10 }), row({ driver_id: "ana", schedule_date: "2026-10-06", km: 10 })];
    const days = driverBonusDays(rows, [...RULES, { id: "fx", amount: 100, minimum_distance: 0, maximum_distance: null, calculation_type: "fixed_monthly" }], {
      monthly: true,
      eligible: (f) => driverBonusFor(t, { client_id: f.clientId, schedule_date: f.date, driver_id: f.driverId, driver_bonus: !!f.schedule.driver_bonus }, false),
    });
    // Dia 05: só o frete extra (cliente com transporte montado) conta: 10 km
    expect(days.map((d) => [d.date, d.km, d.amount])).toEqual([["2026-10-05", 10, 113.05], ["2026-10-06", 10, 13.05]]);
  });
});

describe("Regra única de VT (vtForDay)", () => {
  const base = { workMark: undefined, clientDefault: true };
  it("segue a ordem do Fechamento", () => {
    expect(vtForDay(base)).toBe(true);
    expect(vtForDay({ ...base, workMark: false })).toBe(false);
    expect(vtForDay({ workMark: null, clientDefault: false, homeCity: "Pouso Alegre" })).toBe(true);
    expect(vtForDay({ ...base, vtEnabled: false })).toBe(false);
    // Marcação da pessoa vale mais que cadastro/obra
    expect(vtForDay({ ...base, vtEnabled: false, override: true })).toBe(true);
    expect(vtForDay({ ...base, override: false })).toBe(false);
    // Alojamento que bloqueia (Americana na Suzano)
    expect(vtForDay({ ...base, lodgingBlocks: true })).toBe(false);
    // VT cheio: sempre, mesmo com marcação desligada
    expect(vtForDay({ ...base, override: false, alwaysFull: true })).toBe(true);
    // Montador alojado em Mogi Guaçu: nunca, nem com VT cheio
    expect(vtForDay({ ...base, alwaysFull: true, vtNever: true })).toBe(false);
  });
  it("transporte montado manda sobre a marcação", () => {
    const t = buildTransport([{ client_id: "c", schedule_date: "2026-10-05", collaborator_id: "own", vehicle_schedule_id: null }, { client_id: "c", schedule_date: "2026-10-05", collaborator_id: "car", vehicle_schedule_id: "v" }]);
    const at = { ...base, override: true, transport: t, clientId: "c", date: "2026-10-05" };
    expect(vtForDay({ ...at, collaboratorId: "own" })).toBe(true);
    expect(vtForDay({ ...at, collaboratorId: "car" })).toBe(false);
    expect(vtForDay({ ...at, collaboratorId: "car", alwaysFull: true })).toBe(true);
  });
  it("passageiro que saiu do cliente não deixa o dia montado", () => {
    const t = buildTransport([{ client_id: "c", schedule_date: "2026-10-05", collaborator_id: "saiu", vehicle_schedule_id: "v" }], () => false);
    expect(t.built.size).toBe(0);
  });
  it("vtBaseForDay = bolinha sem a marcação da pessoa", () => {
    expect(vtBaseForDay({ clientDefault: false, workMark: true })).toBe(true);
    expect(vtBaseForDay({ clientDefault: true, vtEnabled: false })).toBe(false);
  });
});

describe("Prêmio viagem (travelOnFor)", () => {
  it("cadastro desligado nunca recebe, nem com marcação", () => {
    expect(travelOnFor({ enabled: false, override: true, workDefault: true })).toBe(false);
    expect(travelOnFor({ override: true, lodgingBlocks: true, workDefault: false })).toBe(true);
    expect(travelOnFor({ lodgingBlocks: true, workDefault: true })).toBe(false);
    expect(travelOnFor({ workMark: false, workDefault: true })).toBe(false);
    expect(travelOnFor({ workDefault: true })).toBe(true);
  });
});

describe("Resultados: fretes extras e prêmio motorista", () => {
  const empty = { allocs: [], sibAllocs: [], sibRdo: [], rdoWf: [], entries: [], progress: [], people: [], vs: [], client: { name: "Alfa", has_toll: true, toll_amount: 5 }, workVt: [], workTravelRows: [], noVtRows: [], leaves: [], vtRules: [], dbRules: RULES, tbRules: [], cityDist: [], integAppts: [], integBoxes: [], monthlyIds: [], nightIds: [], siblingCount: 1 };
  const work = { id: "w1", client_id: "c1", monthly_enabled: true, orders: [] };
  it("frete extra do cliente entra no transporte (km do extra) e o prêmio do motorista do extra é rateado pelo km", () => {
    const vs = [{ schedule_date: "2026-10-05", client_id: "c9", work_id: null, driver_id: "ana", driver_bonus: true, km: 50, trips: 1, extra_client_ids: ["c1"], extra_driver_ids: ["ana"], extra_work_ids: ["w1"], extra_places: [""], extra_km: 30, vehicles: { km_rate: 1, plate: "AAA" } }];
    const b = buildBase(work, { ...empty, vs, driverVs: vs, people: [{ id: "ana", full_name: "Ana" }] }, "2026-10", "2026-10", { isAll: false, workIds: ["w1"], holidays: [], allWorks: [work] })!;
    // 30 km × R$ 1 + pedágio do cliente (5 × 2)
    expect(b.transportRows.map((r) => [r.km, r.share])).toEqual([[30, 40]]);
    // Ana: 50 + 30 = 80 km → R$ 18 no dia; 30/80 é deste cliente
    expect(b.driverRows.map((r) => Math.round(r.share * 100) / 100)).toEqual([6.75]);
  });
});

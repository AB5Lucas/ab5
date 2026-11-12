import { describe, it, expect } from "vitest";
import { buildBase, monthShare, type BaseOpts } from "./results-engine";

/** Resultados por dias: custos pelos dias exatos; faturamento, andamento e pedidos do mês parcial proporcionais. */
const empty = { allocs: [], sibAllocs: [], sibRdo: [], rdoWf: [], entries: [], progress: [], people: [], vs: [], client: null, workVt: [], workTravelRows: [], noVtRows: [], leaves: [], vtRules: [], dbRules: [], tbRules: [], cityDist: [], integAppts: [], integBoxes: [], monthlyIds: [], nightIds: [], siblingCount: 1 };

describe("fração do mês no período por dias", () => {
  it("dias dentro do período ÷ dias do mês", () => {
    expect(monthShare("2026-11", "2026-11-01", "2026-11-10")).toBeCloseTo(1 / 3);
    expect(monthShare("2026-10", "2026-10-01", "2026-11-10")).toBe(1);
    expect(monthShare("2026-12", "2026-10-01", "2026-11-10")).toBe(0);
    expect(monthShare("2026-11")).toBe(1);
  });
});

describe("Resultados com período por dias", () => {
  it("mensal: custo só dos dias escolhidos e pedido do mês proporcional", () => {
    const w = { id: "m", monthly_enabled: true, orders: [{ date: "2026-10-31", value: 2000 }, { date: "2026-11-30", value: 3000 }] };
    const opts: BaseOpts = { isAll: false, workIds: ["m"], holidays: [], allWorks: [w], fromDate: "2026-11-01", toDate: "2026-11-10" };
    const raw = { ...empty, entries: [
      { work_id: "m", category: "materiais", entry_date: "2026-11-05", amount: 100 },
      { work_id: "m", category: "materiais", entry_date: "2026-11-20", amount: 50 },
    ] };
    const b = buildBase(w, raw, "2026-11", "2026-11", opts);
    expect(b?.last?.cost).toBe(100);
    expect(b?.last?.revenue).toBeCloseTo(1000);
    expect(b?.order).toBeCloseTo(1000);
  });

  it("andamento e faturamento do mês parcial entram proporcionais aos dias", () => {
    const w = { id: "a", order_value: 10000 };
    const opts: BaseOpts = { isAll: false, workIds: ["a"], holidays: [], allWorks: [w], fromDate: "2026-10-21", toDate: "2026-11-15" };
    const raw = {
      ...empty,
      progress: [{ work_id: "a", month: "2026-10-31", percent: 40 }, { work_id: "a", month: "2026-11-30", percent: 70 }],
      entries: [
        { work_id: "a", category: "faturamento", entry_date: "2026-10-01", amount: 1000 },
        { work_id: "a", category: "faturamento", entry_date: "2026-11-01", amount: 3000 },
      ],
    };
    const b = buildBase(w, raw, "2026-10", "2026-11", opts);
    const oct = 11 / 31, nov = 15 / 30;
    expect(b?.last?.revenue).toBeCloseTo(10000 * (40 * oct + 30 * nov) / 100);
    expect(b?.last?.billing).toBeCloseTo(1000 * oct + 3000 * nov);
    expect(b?.last?.progress).toBe(70);
  });

  it("sem datas o cálculo continua por mês inteiro", () => {
    const w = { id: "a", order_value: 10000 };
    const opts: BaseOpts = { isAll: false, workIds: ["a"], holidays: [], allWorks: [w] };
    const raw = { ...empty, progress: [{ work_id: "a", month: "2026-10-31", percent: 40 }, { work_id: "a", month: "2026-11-30", percent: 70 }], entries: [{ work_id: "a", category: "faturamento", entry_date: "2026-11-01", amount: 3000 }] };
    const b = buildBase(w, raw, "2026-11", "2026-11", opts);
    expect(b?.last?.revenue).toBeCloseTo(3000);
    expect(b?.last?.billing).toBe(3000);
  });
});

import { describe, it, expect } from "vitest";
import { buildBase, monthlyOrderRevenue, progressUntil, sliceResultRaw, totalMargin, type BaseOpts } from "./results-engine";

const empty = { allocs: [], sibAllocs: [], sibRdo: [], rdoWf: [], entries: [], progress: [], people: [], vs: [], client: null, workVt: [], workTravelRows: [], noVtRows: [], leaves: [], vtRules: [], dbRules: [], tbRules: [], cityDist: [], integAppts: [], integBoxes: [], monthlyIds: [], nightIds: [], siblingCount: 1 };
const w = { id: "m", monthly_enabled: true, order_value: 9999, orders: [{ date: "2026-09-30", value: 1000 }, { date: "2026-10-31", value: 2000 }, { date: "2026-11-30", value: 3000 }] };
const opts: BaseOpts = { isAll: false, workIds: ["m"], holidays: [], allWorks: [w] };
describe("andamento e receita mensal compartilhados", () => {
  it("outubro sempre 100%, receita dos pedidos e custo inalterado", () => {
    const raw = { ...empty, entries: [{ work_id: "m", category: "materiais", entry_date: "2026-10-10", amount: 100 }] };
    const b = buildBase(w, raw, "2026-10", "2026-10", opts);
    expect(b?.last?.progress).toBe(100);
    expect(b?.last?.revenue).toBe(2000);
    expect(b?.last?.cost).toBe(100);
    expect(b?.last?.margin).toBeCloseTo(1526.6);
    if (!b) throw new Error("Missing base");
    expect(progressUntil(w, b, "2026-10")).toBe(100);
  });
  it("meses só com pedido aparecem mesmo sem movimento", () => {
    const b = buildBase(w, empty, "2026-10", "2026-10", opts);
    expect(b?.rows.map((r) => r.ym)).toEqual(["2026-10"]);
    expect(b?.last?.revenue).toBe(2000);
  });
  it("margem histórica não inclui pedidos futuros", () => {
    const b = buildBase(w, empty, "", "2026-10", opts);
    if (!b) throw new Error("Missing base");
    expect(totalMargin(w, b).margin).toBeCloseTo(2439.9);
  });
  it("mensal sem pedido mantém 100%, sem inventar receita", () => {
    const b = buildBase({ ...w, orders: [] }, { ...empty, entries: [{ work_id: "m", category: "materiais", entry_date: "2026-10-10", amount: 100 }] }, "2026-10", "2026-10", opts);
    expect(b?.last?.progress).toBe(100);
    expect(b?.last?.revenue).toBe(0);
    expect(b?.last?.cost).toBe(100);
  });
  it("receita respeita meses não consecutivos", () => expect(monthlyOrderRevenue(w, "", "", ["2026-09", "2026-11"])).toBe(4000));
  it("contrato histórico não conta nota futura", () => {
    const cw = { id: "m", contract_enabled: true, contract_months: 12, order_value: 12000 };
    const b = buildBase(cw, { ...empty, entries: [{ work_id: "m", category: "faturamento", entry_date: "2026-10-10", amount: 1000 }, { work_id: "m", category: "faturamento", entry_date: "2026-11-10", amount: 1000 }] }, "", "", opts);
    if (!b) throw new Error("Missing base");
    expect(progressUntil(cw, b, "2026-10")).toBeCloseTo(100 / 12);
  });
});
describe("lotes financeiros preservam contexto e custos por serviço", () => {
  it("filtra só dados próprios, preservando irmãos/transporte do cliente", () => {
    const raw = { ...empty, allocs: [{ work_id: "a" }, { work_id: "b" }], rdoWf: [{ work_id: "a" }, { work_id: "b" }], entries: [{ work_id: "a", amount: 100 }, { work_id: "b", amount: 200 }], sibAllocs: [{ work_id: "a" }, { work_id: "b" }], vs: [{ work_id: null }] };
    const a = sliceResultRaw(raw, "a");
    expect(a.entries).toEqual([{ work_id: "a", amount: 100 }]);
    expect(a.allocs).toEqual([{ work_id: "a" }]);
    expect(a.sibAllocs).toBe(raw.sibAllocs);
    expect(a.vs).toBe(raw.vs);
  });
});
import { describe, expect, it } from "vitest";
import { ccTotals, fortnightRange } from "./fleet-fiscal";

const part = (cc: string | null, item: string | null, value: number) => ({ client_id: "x", client: "x", days: 1, pct: 100, value, cc, cc_rule: "", item_account: item });

describe("fleet fiscal", () => {
  it("quinzenas", () => {
    expect(fortnightRange(2026, 2, 2)).toEqual({ from: "2026-02-16", to: "2026-02-28" });
    expect(fortnightRange(2026, 11, 1)).toEqual({ from: "2026-11-01", to: "2026-11-15" });
  });
  it("soma por CC sem repetir, tira TICKET e divide serviços/indústria", () => {
    const rateio = (parts: ReturnType<typeof part>[]) => ({ from: "", to: "", fallback: false, parts });
    const t = ccTotals([
      { total: 100, rateio: rateio([part("2004221", "A", 60), part("1001999", "B", 40)]) },
      { total: 50, rateio: rateio([part("2004221", "A", 50)]) },
      { total: 30, rateio: rateio([part("TICKET", "TICKET", 30)]) },
      { total: 50, rateio: null },
    ]);
    expect(t.lines.map((l) => [l.cc, l.value])).toEqual([["1001999", 40], ["2004221", 110], [null, 50]]);
    expect(t.total).toBe(200);
    expect(t.ticket).toBe(30);
    expect(t.share.servicos).toBeCloseTo(55);
    expect(t.share.industria).toBeCloseTo(20);
    expect(t.share.outros).toBeCloseTo(25);
  });
});

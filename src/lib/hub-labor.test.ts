import { describe, expect, it } from "vitest";
import { laborSplit } from "./hub-labor";
const H = new Set(["2026-11-20"]);
describe("laborSplit", () => {
  it("dia útil com 10 h: 8 normais e 2 HE × 1,6, com encargos 2,6", () => {
    const r = laborSplit(10, 10, false, "2026-11-24", H);
    expect(r.normal).toBeCloseTo(208); expect(r.extra).toBeCloseTo(83.2);
  });
  it("sábado: todas as horas HE × 1,6", () => expect(laborSplit(8, 10, false, "2026-11-21", H)).toMatchObject({ normal: 0, extraH: 8 }));
  it("feriado: × 2", () => expect(laborSplit(8, 10, true, "2026-11-20", H).extra).toBeCloseTo(160));
});

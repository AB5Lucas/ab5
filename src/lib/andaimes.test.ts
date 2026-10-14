import { describe, it, expect } from "vitest";
import { shortage, separationStatus, notReturned, romNumber } from "./andaimes";
describe("andaimes", () => {
  it("falta = solicitado − disponível (100 vs 80 = 20)", () => expect(shortage(100, 80)).toBe(20));
  it("falta nunca negativa", () => expect(shortage(10, 80)).toBe(0));
  it("separação total = separada", () => expect(separationStatus([{ requested: 10, separated: 10, available: 20 }])).toBe("separada"));
  it("sem estoque = compra necessária", () => expect(separationStatus([{ requested: 100, separated: 80, available: 80 }])).toBe("compra_necessaria"));
  it("parcial com estoque = parcialmente separada", () => expect(separationStatus([{ requested: 100, separated: 50, available: 100 }])).toBe("parcialmente_separada"));
  it("saiu 100, retornou 97 = 3 não retornadas", () => expect(notReturned(100, [90, 5, 2, 0, 0])).toBe(3));
  it("numeração ROM-000001", () => expect(romNumber(1)).toBe("ROM-000001"));
});

import { inspectionState, depreciation } from "./andaimes";
import { test as t2, expect as e2 } from "vitest";
t2("vistoria vencida e a vencer", () => {
  e2(inspectionState("2026-10-13", "2026-10-14")).toBe("expired");
  e2(inspectionState("2026-10-20", "2026-10-14")).toBe("expiring");
  e2(inspectionState("2026-11-30", "2026-10-14")).toBe("ok");
});
t2("depreciação linear limitada", () => {
  e2(depreciation(1200, 60, "2026-01-10", "2026-07-01")).toBe(120);
  e2(depreciation(1200, 12, "2020-01-01", "2026-07-01")).toBe(1200);
});

import { describe, it, expect } from "vitest";
import { nightHours, laborCost } from "./labor-cost";
describe("adicional noturno", () => {
  it("21:30-05:30 com 1h de intervalo = 6h noturnas", () => expect(nightHours("21:30", "05:30", 60)).toBe(6));
  it("turno diurno não tem horas noturnas", () => expect(nightHours("07:00", "17:00", 60)).toBe(0));
  it("noturno paga +50% nas horas 22h-05h", () => expect(laborCost(7, 10, true, "2026-10-20", new Set(), 6)).toBe(100));
});

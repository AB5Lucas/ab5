import { describe, expect, it } from "vitest";
import { canManagePrizeHours, prizeAmount, prizeDates, prizeMultiplier, prizePeriod } from "./prize-hours";

describe("Horas Prêmio", () => {
  it("uses the 26 to 25 period", () => expect(prizePeriod("2026-10")).toEqual({ start: "2026-09-26", end: "2026-10-25" }));
  it("pays Saturday at 160% without charges", () => expect(prizeAmount(8, 10, prizeMultiplier("2026-10-24", []) ?? 0)).toBe(128));
  it("pays Sunday at 200% without charges", () => expect(prizeAmount(8, 10, prizeMultiplier("2026-10-25", []) ?? 0)).toBe(160));
  it("pays holidays at 200%, including Saturdays", () => expect(prizeMultiplier("2026-10-24", ["2026-10-24"])).toBe(2));
  it("includes weekday holidays and excludes ordinary weekdays", () => {
    expect(prizeDates("2026-10", ["2026-10-12"])).toContain("2026-10-12");
    expect(prizeDates("2026-10", [])).not.toContain("2026-10-13");
  });
  it("restricts access to administrators and programmers", () => {
    expect(canManagePrizeHours("admin")).toBe(true);
    expect(canManagePrizeHours("programmer")).toBe(true);
    for (const role of ["viewer", "encarregado", "coordenador", "cliente"]) expect(canManagePrizeHours(role)).toBe(false);
  });
});
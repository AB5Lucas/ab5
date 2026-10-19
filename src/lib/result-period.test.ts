import { describe, expect, it } from "vitest";
import { isResultMonth } from "./result-period";

describe("Financeiro period in Resultados", () => {
  it("keeps October alone when October is selected", () => {
    expect(isResultMonth("2026-10", "2026-10", "2026-10", ["2026-10"])).toBe(true);
    expect(isResultMonth("2026-09", "2026-10", "2026-10", ["2026-10"])).toBe(false);
  });
  it("excludes gaps between selected months", () => {
    expect(isResultMonth("2026-02", "2026-01", "2026-03", ["2026-01", "2026-03"])).toBe(false);
    expect(isResultMonth("2026-03", "2026-01", "2026-03", ["2026-01", "2026-03"])).toBe(true);
  });
});
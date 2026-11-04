import { describe, expect, it } from "vitest";
import { displayedBudgetItems } from "./result-budget";

describe("monthly budget shown in Resultados", () => {
  const items = [
    { key: "mo", budget: 50000, real: 20000, used: 40 },
    { key: "transporte", budget: 10000, real: 5000, used: 50 },
  ];
  it("shows all monthly costs used in the budget margin even with zero progress", () => {
    const result = displayedBudgetItems(items, 0, { mo: 40000, transporte: 18850 });
    expect(result.map((item) => item.budget)).toEqual([40000, 18850]);
    expect(result.reduce((sum, item) => sum + item.budget, 0)).toBe(58850);
    expect(result[0]?.used).toBe(50);
  });
  it("uses the order-bearing services budget in the client total instead of the saved budget", () => {
    const result = displayedBudgetItems(items, 0.3, { mo: 80000, transporte: 37700 });
    expect(result.reduce((sum, item) => sum + item.budget, 0)).toBe(117700);
  });
  it("keeps the full fixed budget for non-monthly services", () => {
    expect(displayedBudgetItems(items, 0.5).map((item) => item.budget)).toEqual([50000, 10000]);
  });
});
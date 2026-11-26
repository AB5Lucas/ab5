import { describe, expect, it } from "vitest";
import { financeMonthRange } from "./finance-month-selection";

describe("Financeiro month selection", () => {
  it("a click selects only that month, replacing the prior selection", () => {
    expect(financeMonthRange(10)).toEqual([10]);
    expect(financeMonthRange(11)).toEqual([11]);
  });
  it("holding and dragging selects every month in the interval", () => {
    expect(financeMonthRange(8, 11)).toEqual([8, 9, 10, 11]);
  });
  it("dragging backwards and returning shrinks the interval", () => {
    expect(financeMonthRange(11, 8)).toEqual([8, 9, 10, 11]);
    expect(financeMonthRange(11, 10)).toEqual([10, 11]);
  });
});
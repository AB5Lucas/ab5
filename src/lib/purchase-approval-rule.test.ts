import { describe, expect, it } from "vitest";
import { approvalRule, itemsOverBudget, type RecRow } from "./purchase-quotes";

const row = (budget: number | null, total: number | null) =>
  ({ item: { budget }, chosen: total == null ? null : { total } } as unknown as RecRow);
const today = "2026-11-26";

describe("regra de aprovação com verba por item", () => {
  const over = [row(300, 565), row(84.56, 88.9), row(500, 100)];
  it("detecta item acima da própria verba", () => {
    expect(itemsOverBudget(over)).toBe(true);
    expect(itemsOverBudget([row(300, 300), row(null, 999), row(0, 50)])).toBe(false);
  });
  it("total dentro mas item acima e prazo em 5 dias = diretor", () => {
    expect(approvalRule(1447.98, 1687.56, "2026-12-01", today, itemsOverBudget(over))).toBe("diretor");
  });
  it("total dentro mas item acima e prazo em 1 dia = dupla", () => {
    expect(approvalRule(1447.98, 1687.56, "2026-11-27", today, itemsOverBudget(over))).toBe("dupla");
  });
  it("sem item acima e total dentro = verba", () => {
    expect(approvalRule(1447.98, 1687.56, "2026-12-01", today, false)).toBe("verba");
  });
});

import { faOutcome } from "./purchase-quotes";
describe("faOutcome", () => {
  it("pendentes sem decisão = não envia", () => expect(faOutcome(2, 1, 1)).toBeNull());
  it("todos aprovados", () => expect(faOutcome(3, 0, 0)).toBe("aprovada"));
  it("todos recusados", () => expect(faOutcome(0, 3, 0)).toBe("recusada"));
  it("mistura = parcial", () => expect(faOutcome(2, 1, 0)).toBe("parcial"));
});

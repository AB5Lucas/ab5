import { describe, it, expect } from "vitest";
import { contractCutoffs } from "./results-engine";

describe("contractCutoffs", () => {
  it("contrato só considera custos até o fim do mês do último faturamento", () => {
    const w = { id: "t", contract_enabled: true };
    const c = contractCutoffs(w, [
      { work_id: "t", category: "faturamento", entry_date: "2026-08-10" },
      { work_id: "t", category: "faturamento", entry_date: "2026-09-15" },
    ], false);
    expect(c.get("t")).toBe("2026-09-30");
  });
});

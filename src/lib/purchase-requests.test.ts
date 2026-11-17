import { describe, expect, it } from "vitest";
import { budgetMissing, deadlineControl } from "./purchase-requests";

describe("solicitação de compra", () => {
  it("controle de prazo como na planilha", () => {
    const base = { sent_at: "2026-11-10T10:00:00Z", due_date: "2026-11-17", status: "EM ANÁLISE", status_at: "2026-11-12" };
    expect(deadlineControl({ ...base, sent_at: null }, "2026-11-12").label).toBe("NÃO ENVIADO");
    expect(deadlineControl(base, "2026-11-16").label).toBe("DENTRO DO PRAZO");
    expect(deadlineControl(base, "2026-11-17").label).toBe("NO LIMITE");
    expect(deadlineControl(base, "2026-11-18").label).toBe("FORA DO PRAZO");
    // Compra efetivada: vale a data do status, não hoje.
    expect(deadlineControl({ ...base, status: "COMPRA EFETIVADA", status_at: "2026-11-15" }, "2026-11-30").label).toBe("DENTRO DO PRAZO");
  });
  it("verba: por item ou total, menos PROGRAMADA", () => {
    expect(budgetMissing("PONTUAL", null, [10, null])).toBe(true);
    expect(budgetMissing("PONTUAL", 100, [null])).toBe(false);
    expect(budgetMissing("PONTUAL", null, [10, 5])).toBe(false);
    expect(budgetMissing("PROGRAMADA", null, [null])).toBe(false);
  });
});

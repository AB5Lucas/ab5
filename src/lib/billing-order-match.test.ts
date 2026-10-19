import { describe, expect, it } from "vitest";
import { billingMatchesOrder, parseBillingRows, quoteKey } from "./billing-sync";

const header = ["Data", "Cliente", "NFSe", "Nro. Pedido", "Proposta", "R$ Bruto", "Cancelada?"];

describe("faturamento sem NF e baixa de pedidos", () => {
  it("lança linha sem NF com cliente e valor", () => {
    const n = parseBillingRows([header, ["07/10/2026", "TENNECO", "", "4510500698", "N/A", 4000, ""]]).notes[0];
    expect(n?.error).toBeUndefined();
    expect(n?.noInvoice).toBe(true);
    expect(n?.amountCents).toBe(400000);
  });
  it("orçamento 26/256 vira 260256", () => {
    expect(quoteKey("26/256")).toBe("260256");
    expect(quoteKey("26/0256")).toBe("260256");
  });
  it("liquida pedido no formato novo com NF", () => {
    expect(billingMatchesOrder("NFSe 1680 · Pedido 4401032672", "4401032672")).toBe(true);
  });
  it("liquida pedido no formato sem NF", () => {
    expect(billingMatchesOrder("Sem NF · Pedido 4510500698", "4510500698")).toBe(true);
  });
  it("liquida pedido lançado pelo orçamento com barra", () => {
    expect(billingMatchesOrder("NFSe 1700 · Orçamento 26/256", "260256")).toBe(true);
  });
  it("não liquida outro pedido", () => {
    expect(billingMatchesOrder("NFSe 1680 · Pedido 4401032672", "4401041834")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { fileMatchesOrder, purchaseOrdersFolder } from "./purchase-orders";

describe("pedido de compras na pasta", () => {
  it("pasta do ano", () => expect(purchaseOrdersFolder(2026)).toBe("Compras/04 COMPRAS/02 PEDIDOS DE COMPRAS/2026"));
  it("casa o número inteiro no nome", () => {
    expect(fileMatchesOrder("PC 12345 - FORNECEDOR.pdf", "12345")).toBe(true);
    expect(fileMatchesOrder("Pedido_012345.pdf", "12345")).toBe(true);
    expect(fileMatchesOrder("PC 123456.pdf", "12345")).toBe(false);
    expect(fileMatchesOrder("PC 2026.pdf", "12")).toBe(false);
  });
});

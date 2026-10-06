import { describe, expect, it } from "vitest";
import { contractFraction } from "./contract";

describe("contractFraction", () => {
  it("6 faturamentos em 12 meses = 50%", () => expect(contractFraction(6, 12)).toBe(0.5));
  it("não passa de 100%", () => expect(contractFraction(14, 12)).toBe(1));
  it("meses inválidos usam 12", () => expect(contractFraction(3, 0)).toBe(0.25));
});

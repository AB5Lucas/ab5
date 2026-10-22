import { describe, expect, it } from "vitest";
import { bdiBudget } from "./results-engine";
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
describe("BDI dinâmico", () => {
  it("mantém o total em pedido × 0,5885", () => {
    expect(sum(bdiBudget(10000, { mo: 5000, transporte: 100 }))).toBeCloseTo(5885, 0);
  });
  it("sem custos usa os pesos da obra", () => {
    const b = bdiBudget(10000, {}, { weights: { mo: 70, transporte: 10, ferramentas: 10, materiais: 10, andaimes: 0 } });
    expect(b["mo"]).toBeCloseTo(4119.5, 1);
  });
  it("75% acompanha o gasto real: sobra do transporte vai para a MO", () => {
    const b = bdiBudget(10000, { mo: 900, transporte: 100 }, { weights: { mo: 50, transporte: 50, ferramentas: 0, materiais: 0, andaimes: 0 } });
    expect(b["mo"]).toBeCloseTo(5885 * (0.25 * 0.5 + 0.75 * 0.9), 1);
  });
});

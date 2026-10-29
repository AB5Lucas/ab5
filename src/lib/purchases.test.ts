import { describe, expect, it } from "vitest";
import { allocatePurchase, purchaseFileMonth } from "./purchases";

const clients = [{ id: "adm", prefix: "2000" }, { id: "mars", prefix: "2004" }, { id: "x", prefix: null }];
const works = [
  { id: "adm1", client_id: "adm", suffix: null },
  { id: "m1", client_id: "mars", suffix: "223" },
  { id: "m2", client_id: "mars", suffix: "223" },
  { id: "m3", client_id: "mars", suffix: "221" },
];
const hours = new Map([["adm1", 100], ["m1", 30], ["m2", 10], ["m3", 60]]);

describe("rateio de compras", () => {
  it("cliente com um só serviço com movimentação recebe o total (Administrativo)", () => {
    const a = allocatePurchase("2000", 129655.42, clients, works, hours);
    expect(a.parts).toEqual([{ work_id: "adm1", amount: 129655.42 }]);
  });
  it("sufixo repetido rateia por horas", () => {
    const a = allocatePurchase("2004223", 100, clients, works, hours);
    expect(a.parts).toEqual([{ work_id: "m1", amount: 75 }, { work_id: "m2", amount: 25 }]);
  });
  it("sufixo sem serviço rateia entre serviços do cliente com movimentação", () => {
    const a = allocatePurchase("2004999", 100, clients, works, hours);
    expect(a.parts.map((p) => p.amount)).toEqual([30, 10, 60]);
  });
  it("sem cliente fica pendente", () => {
    expect(allocatePurchase("2075011", 10, clients, works, hours).status).toBe("pending");
  });
  it("cliente sem movimentação fica pendente", () => {
    expect(allocatePurchase("2000", 10, clients, works, new Map()).status).toBe("pending");
  });
  it("direcionado a um serviço recebe o total", () => {
    expect(allocatePurchase("2075011", 10, clients, works, hours, { work_id: "m3" }).parts).toEqual([{ work_id: "m3", amount: 10 }]);
  });
  it("mês pelo fim do período", () => {
    expect(purchaseFileMonth("01.10.2026-22.10.2026.xls")).toEqual({ ym: "2026-10", end: "2026-10-22" });
  });
});

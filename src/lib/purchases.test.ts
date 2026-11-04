import { describe, expect, it } from "vitest";
import { allocatePurchase, parsePurchaseReport, purchaseFileMonth } from "./purchases";

const clients = [{ id: "adm", prefix: "2000" }, { id: "mars", prefix: "2004" }, { id: "x", prefix: null }];
const works = [
  { id: "adm1", client_id: "adm", suffix: null },
  { id: "m1", client_id: "mars", suffix: "223" },
  { id: "m2", client_id: "mars", suffix: "223" },
  { id: "m3", client_id: "mars", suffix: "221" },
];
const hours = new Map([["adm1", 100], ["m1", 30], ["m2", 10], ["m3", 60]]);

const realRow = (values: Record<number, unknown>): unknown[] => Array.from({ length: 25 }, (_, i) => values[i] ?? "");
describe("leitura ABCOM003", () => {
  const realHeader = [realRow({ 2: "(ABCOM003)" }), realRow({ 6: "Centro Custo:", 8: "2118001", 9: "OBRA" }), realRow({ 11: "Quantidade", 18: "Vlr. Total" })];
  it("lê valor total e quantidade do layout real com cabeçalhos mesclados", () => {
    const result = parsePurchaseReport([...realHeader,
      realRow({ 2: "MF02219", 5: "EXAUSTOR INSUFLADOR DE AR 300MM", 12: 1, 17: 2600 }),
      realRow({ 2: "MF02220", 5: 'DUTO FLEXIVEL PVC 1/2" X 10 M 300MM', 12: 1, 17: 1200 }),
      realRow({ 12: "Total C/C:", 17: 3800 }),
    ]);
    expect(result[0]?.amount).toBe(3800);
    expect(result[0]?.items.map(({ code, qty, amount }) => ({ code, qty, amount }))).toEqual([{ code: "MF02219", qty: 1, amount: 2600 }, { code: "MF02220", qty: 1, amount: 1200 }]);
    expect(result[0]?.items[0]?.desc).toBe("EXAUSTOR INSUFLADOR DE AR 300MM");
    expect(result[0]?.items[0]?.date).toBeNull();
  });
  it("não confunde quantidade 100 com valor 95", () => {
    const result = parsePurchaseReport([...realHeader, realRow({ 2: "AD00091", 5: "SALGADO ASSADO", 12: 100, 17: 95 })]);
    expect(result[0]?.items[0]).toMatchObject({ qty: 100, amount: 95, desc: "SALGADO ASSADO" });
  });
  it.each(["Valor Total", "Vlr. Total", "Total"])("localiza colunas reorganizadas por %s, ignorando unitário", (total) => {
    const result = parsePurchaseReport([["Descrição", "Data", total, "Produto", "Valor Unitário", "Qtde"], ["Centro Custo:", "2118001", "OBRA"], ["EXAUSTOR", "04/10/2026", "R$ 5.200,00", "MF02219", 2600, 2]]);
    expect(result[0]?.items[0]).toEqual({ code: "MF02219", desc: "EXAUSTOR", qty: 2, amount: 5200, date: "2026-10-04" });
  });
  it("lê data serial do Excel na coluna identificada", () => {
    const result = parsePurchaseReport([["Código", "Descrição", "Quantidade", "Valor Total", "Data"], ["Centro Custo:", "2118001"], ["MF02219", "EXAUSTOR", 1, 2600, 46300]]);
    expect(result[0]?.items[0]?.date).toBe("2026-10-05");
  });
  it("falha sem cabeçalho financeiro em vez de usar a quantidade", () => {
    expect(() => parsePurchaseReport([realHeader[0] ?? [], realHeader[1] ?? [], realRow({ 2: "MF02219", 5: "EXAUSTOR", 12: 1, 17: 2600 })])).toThrow(/cabeçalho Quantidade e Valor Total não encontrado/);
  });
  it("rejeita divergência com o total de controle", () => {
    expect(() => parsePurchaseReport([...realHeader, realRow({ 2: "MF02219", 5: "EXAUSTOR", 12: 1, 17: 2600 }), realRow({ 12: "Total C/C:", 17: 1 })])).toThrow(/total do CC 2118001 não confere/);
  });
});

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

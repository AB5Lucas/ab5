import { describe, expect, it } from "vitest";
import { allocatePurchase, parsePurchaseReport, purchaseFileMonth, purchaseCategory, purchaseItemEntries } from "./purchases";

const clients = [{ id: "adm", prefix: "2000" }, { id: "mars", prefix: "2004" }, { id: "x", prefix: null }];
const works = [
  { id: "adm1", client_id: "adm", suffix: null },
  { id: "m1", client_id: "mars", suffix: "223" },
  { id: "m2", client_id: "mars", suffix: "223" },
  { id: "m3", client_id: "mars", suffix: "221" },
];
const hours = new Map([["adm1", 100], ["m1", 30], ["m2", 10], ["m3", 60]]);

describe("classificação financeira de compras", () => {
  it.each(["AE00004", "CBBC279", "AE00001"])("%s é Insumos na Indústria", (code) => {
    expect(purchaseCategory(code, true)).toBe("andaimes");
  });
  it.each(["MF02219", "VC00001", "CBBC280", "BROCA", "AD00091"])("%s permanece Materiais na Indústria", (code) => {
    expect(purchaseCategory(code, true)).toBe("materiais");
  });
  it.each(["AE00004", "CBBC279", "AE00001", "MF02219"])("%s permanece Materiais fora da Indústria", (code) => {
    expect(purchaseCategory(code, false)).toBe("materiais");
  });
});

describe("lançamentos de compras por item", () => {
  const items = [{ code: "AE00001", desc: "ENERGIA", qty: 1, amount: 10.01 }, { code: "MF02219", desc: "EXAUSTOR", qty: 2, amount: 20.02 }];
  const industry = new Set(["m1", "m2"]);
  it("rateia cada item nas mesmas horas do CC, com grupos separados e total exato", () => {
    let group = 0;
    const a = allocatePurchase("2004223", 30.03, clients, works, hours);
    const rows = purchaseItemEntries(items, 30.03, a, hours, industry, "2026-10-31", () => `group-${++group}`);
    expect(rows.map((r) => [r.work_id, r.category, r.amount, r.split_group, r.split_total])).toEqual([
      ["m1", "andaimes", 7.51, "group-1", 10.01], ["m2", "andaimes", 2.50, "group-1", 10.01],
      ["m1", "materiais", 15.02, "group-2", 20.02], ["m2", "materiais", 5, "group-2", 20.02],
    ]);
    expect(rows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0)).toBe(3003);
  });
  it("preserva direcionamento manual e não cria Ferramentas", () => {
    const a = allocatePurchase("2075011", 30.03, clients, works, hours, { work_id: "m3" });
    const rows = purchaseItemEntries(items, 30.03, a, hours, new Set(["m3"]), "2026-10-31");
    expect(rows.map((r) => [r.work_id, r.category, r.amount, r.split_group])).toEqual([["m3", "andaimes", 10.01, null], ["m3", "materiais", 20.02, null]]);
  });
  it("fora da Indústria mantém todos os itens em Materiais", () => {
    const a = allocatePurchase("2000", 30.03, clients, works, hours);
    expect(purchaseItemEntries(items, 30.03, a, hours, industry, "2026-10-31").map((r) => r.category)).toEqual(["materiais", "materiais"]);
  });
  it("corrige um centavo no último item sem alterar o total do CC", () => {
    const a = allocatePurchase("2000", 30.04, clients, works, hours);
    expect(purchaseItemEntries(items, 30.04, a, hours, industry, "2026-10-31").map((r) => r.amount)).toEqual([10.01, 20.03]);
  });
  it("rejeita totais divergentes antes de substituir lançamentos", () => {
    const a = allocatePurchase("2000", 31, clients, works, hours);
    expect(() => purchaseItemEntries(items, 31, a, hours, industry, "2026-10-31")).toThrow("Total dos itens não confere");
  });
  it("fecha centavos no último serviço mesmo com divisão em três", () => {
    const a = allocatePurchase("2004999", 0.02, clients, works, hours);
    const rows = purchaseItemEntries([{ code: "MF02219", desc: "EXAUSTOR", qty: 1, amount: 0.02 }], 0.02, a, hours, industry, "2026-10-31");
    expect(rows.map((r) => r.amount)).toEqual([0.01, 0, 0.01]);
    expect(rows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0)).toBe(2);
  });
});

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

describe("outros prefixos do cliente", () => {
  it("CC com prefixo alternativo vai para os serviços do cliente (ex.: 2111 = Três Corações)", () => {
    const cs = [{ id: "tc", prefix: "2117", altPrefixes: ["2111"] }];
    const ws = [{ id: "t1", client_id: "tc", suffix: null }, { id: "t2", client_id: "tc", suffix: null }];
    const a = allocatePurchase("2111999", 100, cs, ws, new Map([["t1", 30], ["t2", 70]]));
    expect(a.status).toBe("launched");
    expect(a.parts).toEqual([{ work_id: "t1", amount: 30 }, { work_id: "t2", amount: 70 }]);
  });
  it("o prefixo principal de outro cliente vence o alternativo", () => {
    const cs = [{ id: "a", prefix: null, altPrefixes: ["2004"] }, { id: "mars", prefix: "2004" }];
    const a = allocatePurchase("2004999", 10, cs, [{ id: "m", client_id: "mars", suffix: null }], new Map([["m", 1]]));
    expect(a.parts[0]!.work_id).toBe("m");
  });
});

describe("Almoxarifado do cliente", () => {
  const cs = [{ id: "ype", prefix: "2043" }];
  it("sem serviço com movimentação e sem Almoxarifado: pendente para o servidor criar o Almoxarifado", () => {
    const a = allocatePurchase("2043999", 459, cs, [], new Map());
    expect(a.status).toBe("pending");
    expect(a.reason).toBe("Nenhum serviço do cliente com movimentação no mês");
  });
  it("com o Almoxarifado criado: lança nele", () => {
    const a = allocatePurchase("2043999", 459, cs, [{ id: "alm", client_id: "ype", suffix: null, stock: true }], new Map());
    expect(a.status).toBe("launched");
    expect(a.parts).toEqual([{ work_id: "alm", amount: 459 }]);
  });
  it("quando um serviço do cliente passa a ter movimentação, o custo vai para ele e sai do Almoxarifado", () => {
    const ws = [{ id: "alm", client_id: "ype", suffix: null, stock: true }, { id: "s1", client_id: "ype", suffix: null }];
    const a = allocatePurchase("2043999", 459, cs, ws, new Map([["s1", 8]]));
    expect(a.parts).toEqual([{ work_id: "s1", amount: 459 }]);
  });
});

describe("parsePurchaseReport, linha do centro de custo", () => {
  const head = [["Código", "Descrição", "Quantidade", "Valor Total"]];
  it("aceita rótulo, código e nome na mesma célula", () => {
    const r = parsePurchaseReport([...head, ["Centro Custo: 1001000 - ADM"], ["AA001", "X", 1, 10], ["Total C/C:", "", "", 10],
      ["Centro Custo: 1001001 PINTURA PO"], ["AA002", "Y", 1, 5], ["Total C/C:", "", "", 5]]);
    expect(r.map((l) => [l.cc, l.amount])).toEqual([["1001000", 10], ["1001001", 5]]);
  });
  it("item depois do total sem novo centro de custo não soma no anterior", () => {
    expect(() => parsePurchaseReport([...head, ["Centro Custo:", "1001000"], ["AA001", "X", 1, 10], ["Total C/C:", "", "", 10], ["AA002", "Y", 1, 5]]))
      .toThrow(/sem centro de custo reconhecido/);
  });
});

describe("parsePurchaseReport, CC sem rótulo", () => {
  it("linha só com código de 7 dígitos e nome abre o centro de custo", () => {
    const rows = [["(ABCOM003)"], ["Centro Custo:", "1001000", "ADM"], ["", "Quantidade", "", "Vlr. Total"],
      ["AA001", "X", 1, 10], ["Total C/C:", 10], [1001001, "PINTURA PO"], ["AA002", "Y", 2, 5], ["Total C/C:", 5]];
    const r = parsePurchaseReport(rows);
    expect(r.map((l) => [l.cc, l.name, l.amount])).toEqual([["1001000", "ADM", 10], ["1001001", "PINTURA PO", 5]]);
  });
});

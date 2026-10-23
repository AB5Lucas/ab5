import { describe, expect, it } from "vitest";
import { classifyService, invoiceFolderName, missingStatus, monthsToSync, ordersFileName, parseInvoices, parseOrders, parseWorksBillingRows, stripZeros } from "./industry-sync";

describe("indústria", () => {
  for (const description of ["SERVICOS COBRANCA OBRAS 3%", "SERVICOS OBRAS EXTERNAS MANUT/REPARO"]) {
    it(`encaminha ${description} somente para Serviços`, () => {
      const r: unknown[] = Array(44).fill("");
      r[1] = "001702"; r[7] = "2026-10-23"; r[12] = "MOINHO"; r[16] = "8395"; r[25] = description; r[43] = 1602.82;
      expect(parseInvoices([r])).toEqual([]);
      expect(parseWorksBillingRows([r])[0]).toMatchObject({ invoice: "1702", issuedAt: "2026-10-23", client: "MOINHO", order: "8395", amountCents: 160282 });
    });
  }
  it("agrupa itens da mesma NF e pedido e conserva a chave ao atualizar valores", () => {
    const r: unknown[] = Array(44).fill("");
    r[1] = "1702"; r[7] = "2026-10-23"; r[12] = "MOINHO"; r[16] = "8395"; r[25] = "SERVIÇOS OBRAS EXTERNAS MANUT/REPARO"; r[43] = 100;
    const second = [...r]; second[43] = 50;
    expect(parseWorksBillingRows([r, second])).toHaveLength(1);
    expect(parseWorksBillingRows([r, second])[0]?.amountCents).toBe(15000);
    expect(parseWorksBillingRows([r, second])[0]?.key).toBe(parseWorksBillingRows([r])[0]?.key);
  });
  it("remove zeros à esquerda", () => { expect(stripZeros("00012345")).toBe("12345"); expect(stripZeros("027578")).toBe("27578"); });
  it("classifica serviços", () => {
    for (const c of ["PPO", "N", "REN", "PPO N", " ppo  n "]) expect(classifyService(c)).toBe("PPO");
    expect(classifyService("CARR")).toBe("Carrinhos"); expect(classifyService("PLQ")).toBe("Pliq");
    expect(classifyService("Rem")).toBe("Remoção"); expect(classifyService("Jato")).toBe("Jato");
    expect(classifyService("XYZ")).toBeNull();
  });
  it("nomes de pasta e arquivo na virada do ano", () => {
    expect(ordersFileName("2026-10")).toBe("26 OUT.xlsx"); expect(ordersFileName("2027-01")).toBe("27 JAN.xlsx");
    expect(invoiceFolderName("2026-10")).toBe("10 OUTUBRO 2026"); expect(invoiceFolderName("2027-02")).toBe("02 FEVEREIRO 2027");
  });
  it("tolerância de 7 dias", () => {
    expect(monthsToSync("2027-01-03")).toEqual(["2026-12", "2027-01"]); expect(monthsToSync("2026-10-21")).toEqual(["2026-10"]);
    expect(missingStatus("2026-11", "2026-11-06")).toBe("waiting"); expect(missingStatus("2026-11", "2026-11-08")).toBe("access_error");
  });
  it("ignora REC e importa números válidos", () => {
    const rows = [["", "OP"], ["", "REC", "", "X", "", "", "CARR", "", "", 10, "", "", 100, "", 46300], ["", 27493, "", "TINTI", "", "", "CARR", "", "", 3402, "", "", 10200, "", 46300]];
    const r = parseOrders(rows); expect(r.orders.map(o => o.order)).toEqual(["27493"]); expect(r.ignored).toBe(1); expect(r.orders[0]?.mp).toBe(3402);
  });
  it("coluna Faturamento com vários pedidos rateia o valor entre eles", () => {
    const rows: unknown[][] = [["", "OP", "", "CLIENTE", "", "", "DIV", "", "", "MP REAL", "", "", "REALIZ. R$", "FATURAMENTO"], ["", "REC", "", "A LOPES", "", "", "JATO", "", "", 544.38, "", "", 3353.57, "027618 / 27619", 46300]];
    const o = parseOrders(rows).orders;
    expect(o.map(x => x.order)).toEqual(["27618", "27619"]); expect(o.map(x => x.amount)).toEqual([1676.79, 1676.78]); expect(o[0]?.service).toBe("Jato");
  });
  it("coluna Faturamento vazia usa a OP da coluna B; sem nenhuma, ignora", () => {
    const rows: unknown[][] = [["", "OP", "", "CLIENTE", "", "", "DIV", "", "", "MP REAL", "", "", "REALIZ. R$", "FATURAMENTO"], ["", 27700, "", "X", "", "", "JATO", "", "", 0, "", "", 100, "", 46300], ["", "REC", "", "Y", "", "", "JATO", "", "", 0, "", "", 50, "", 46300]];
    const r = parseOrders(rows); expect(r.orders.map(x => x.order)).toEqual(["27700"]); expect(r.ignored).toBe(1);
  });
  it("sem coluna Faturamento, a coluna B com vários números é ignorada", () => {
    const rows: unknown[][] = [["", "OP", "", "CLIENTE", "", "", "DIV"], ["", "27618 / 27619", "", "A LOPES", "", "", "JATO"]];
    expect(parseOrders(rows).orders).toHaveLength(0);
  });
  it("soma itens da mesma nota", () => {
    const row = (v: number) => { const r: unknown[] = Array(44).fill(""); r[1] = "000028613"; r[7] = 46303; r[12] = "SÃO GABRIEL"; r[16] = "027423"; r[43] = v; return r; };
    const inv = parseInvoices([row(23.28), row(5.34)]);
    expect(inv).toHaveLength(1); expect(inv[0]?.amount).toBe(28.62); expect(inv[0]?.invoice).toBe("28613"); expect(inv[0]?.order).toBe("27423");
  });
  it("ignora notas de cobrança de obras", () => {
    const row = (nf: string, d: string) => { const r: unknown[] = Array(44).fill(""); r[1] = nf; r[7] = 46303; r[16] = "027570"; r[25] = d; r[43] = 100; return r; };
    const inv = parseInvoices([row("1616", "SERVICOS COBRANCA OBRAS 3,5%"), row("1677", "SERVICOS DA INDUSTRIA ISS 3%")]);
    expect(inv.map(i => i.invoice)).toEqual(["1677"]);
  });
  it("planilha antiga sem DIV: lê pelo cabeçalho e pelo texto do cliente", () => {
    const rows = [["FR","OP","ENTRADA","CLIENTE","Qtd","DIV","PREV. MP","%","MP REAL","%2","FAT. R$","REALIZ. R$","DATA PREV","TERM EFETIVO"], [1, 25405, 0, "ROSSI LOJA 19 - carrinhos", 10, "VENDA", 0, 0, 59.2, 0, 0, 1623.49, 0, 46087]];
    const o = parseOrders(rows).orders[0]; expect(o?.service).toBe("Carrinhos"); expect(o?.mp).toBe(59.2); expect(o?.amount).toBe(1623.49);
  });
  it("ignora Tenneco (faturada em Serviços)", () => {
    const row = (nf: string, c: string) => { const r: unknown[] = Array(44).fill(""); r[1] = nf; r[7] = 46303; r[12] = c; r[16] = "027544"; r[43] = 100; return r; };
    expect(parseInvoices([row("1592", "TENNECO MOGI MIRIM"), row("1593", "PINHALENSE")]).map(i => i.invoice)).toEqual(["1593"]);
  });
});

import { parseOrders as po2 } from "./industry-sync";
import { test as t2, expect as e2 } from "vitest";
t2("importa pedidos com data na coluna O, mesmo com valor 0; sem data, ignora", () => {
  const head = ["FR","OP","ENTRADA","Cliente","Material","Qtd","DIV","PREV. MP","%","MP REAL","%2","FAT. R$","REALIZ. R$","DATA PREV","DATA FINAL","FATURAMENTO"];
  const rows: unknown[][] = [head, ["", 27515, "", "PINHALENSE", "", "", "PPO N", 207.9, "", "", "", 5420, 5420, 46294, "", ""], ["", 27493, "", "TINTI", "", "", "CARR", 10, "", "", "", 10200, "", 46294, 46300, ""]];
  const r = po2(rows);
  e2(r.orders.map(o => o.order)).toEqual(["27493"]); e2(r.orders[0]!.amount).toBe(0);
});

describe("OP dividida entre setores", () => {
  it("rateia o valor pelo setor (DIV) de cada linha; o maior setor é o principal", () => {
    const h = ["", "OP", "", "Cliente", "", "", "DIV", "", "", "MP", "", "FAT. R$", "REALIZ. R$", "", "Data"];
    const rows = [h,
      [1, 27536, 0, "ROSSI LOJA 14", "CESTOS", 0, "REN", 0, 0, 25.1, 0, 690.68, 690.68, 0, 46297],
      [1, 27536, 0, "ROSSI LOJA 14", "CARRINHOS", 0, "CARR", 0, 0, 257.6, 0, 2398.94, 2398.94, 0, 46304]];
    const { orders } = parseOrders(rows as any);
    const o = orders.find(x => x.order === "27536")!;
    expect(o.service).toBe("Carrinhos");
    expect(o.splits?.map(p => [p.service, p.amount])).toEqual([["Carrinhos", 2398.94], ["PPO", 690.68]]);
  });
});
t2("matéria-prima vem só da coluna J (MP REAL), sem usar PREV. MP", () => {
  const head = ["FR","OP","ENTRADA","Cliente","Material","Qtd","DIV","PREV. MP","%","MP REAL","%2","FAT. R$","REALIZ. R$","DATA PREV","DATA FINAL","FATURAMENTO"];
  const rows = [head, [1, 27621, 0, "TENDA", "", 1, "PPO", 2392, 0, "", 0, 0, 1000, 0, 46300, ""]];
  e2(po2(rows).orders[0]?.mp).toBeNull();
});

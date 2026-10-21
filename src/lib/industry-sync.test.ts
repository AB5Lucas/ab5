import { describe, expect, it } from "vitest";
import { classifyService, invoiceFolderName, missingStatus, monthsToSync, ordersFileName, parseInvoices, parseOrders, stripZeros } from "./industry-sync";

describe("indústria", () => {
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

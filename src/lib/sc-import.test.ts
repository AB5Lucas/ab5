import { describe, it, expect } from "vitest";
import { SC_IMPORT_COLUMNS, SC_IMPORT_RATEIO, headerMap, matchWork, normUnit, parseBrNumber, parseScImport } from "./sc-import";

const works = [
  { id: "w1", name: "Andaimes Engenharia Klaus", order_number: "4502503659" },
  { id: "w2", name: "Manutenção Caldeira", order_number: null },
];

describe("sc-import", () => {
  it("números brasileiros e de planilha", () => {
    expect(parseBrNumber("1.234,50")).toBe(1234.5);
    expect(parseBrNumber("R$ 50,00")).toBe(50);
    expect(parseBrNumber("1,5")).toBe(1.5);
    expect(parseBrNumber("1.000")).toBe(1000);
    expect(parseBrNumber("2.5")).toBe(2.5);
    expect(parseBrNumber(12.5)).toBe(12.5);
    expect(parseBrNumber("")).toBeNull();
    expect(parseBrNumber("abc")).toBeNaN();
  });
  it("títulos com e sem acento e variações", () => {
    expect(headerMap([...SC_IMPORT_COLUMNS])?.size).toBe(9);
    const m = headerMap(["Quantidade", "Unidade", "Descricao", "Verba", "Obs", "Serviço"]);
    expect([...m!.values()]).toEqual(["quantity", "unit", "description", "budget", "notes", "work"]);
    expect(headerMap(["Nome", "Valor"])).toBeNull();
  });
  it("unidade: maiúsculas e sinônimos", () => {
    expect(normUnit("pç")).toEqual({ unit: "PC", known: true });
    expect(normUnit("m2")).toEqual({ unit: "M²", known: true });
    expect(normUnit("fardo")).toEqual({ unit: "FARDO", known: false });
    expect(normUnit("")).toEqual({ unit: "UN", known: true });
  });
  it("centro de custo pelo nome, pedido ou rateio", () => {
    expect(matchWork("", works)).toEqual({ id: SC_IMPORT_RATEIO });
    expect(matchWork("Rateio geral", works)).toEqual({ id: SC_IMPORT_RATEIO });
    expect(matchWork("manutencao caldeira", works)).toEqual({ id: "w2" });
    expect(matchWork("4502503659 - Andaimes Engenharia Klaus", works)).toEqual({ id: "w1" });
    expect(matchWork("4502503659", works)).toEqual({ id: "w1" });
    expect("error" in matchWork("Pintura", works)).toBe(true);
  });
  it("lê as linhas, pula vazias e aponta erros por linha", () => {
    const m = [
      ["SOLICITAÇÃO DE COMPRAS"],
      [...SC_IMPORT_COLUMNS],
      [1, "2", "un", "Luva de vaqueta", "R$ 50,00", "tam. G", "www.loja.com/luva", "Rateio geral", ""],
      [],
      [2, "x", "PC", "", "", "", "", "Pintura", "2001"],
      [3, 3, "fardo", "Estopa", "1.200,5", "", "sem link", "Manutenção Caldeira", "20.01-999"],
    ];
    const { rows, error } = parseScImport(m, works);
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 3, quantity: "2", unit: "UN", description: "Luva de vaqueta", budget: "50", notes: "tam. G", link: "https://www.loja.com/luva", work_id: SC_IMPORT_RATEIO, cc: "", errors: [] });
    expect(rows[1]!.line).toBe(5);
    expect(rows[1]!.errors).toHaveLength(3); // qtd, descrição, centro de custo
    expect(rows[2]).toMatchObject({ unit: "FARDO", budget: "1200,5", work_id: "w2", cc: "2001999", errors: [] });
    expect(rows[2]!.warnings[0]).toContain("fora da lista");
    expect(rows[2]!.link).toBe("");
    expect(rows[2]!.warnings.some((w) => w.startsWith("Link ignorado"))).toBe(true);
  });
  it("sem títulos: erro geral", () => {
    expect(parseScImport([["a", "b"]], works).error).toBeTruthy();
  });
});

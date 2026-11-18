import { describe, expect, it } from "vitest";
import { contractMeasured, findScaffoldWork, isScaffoldRow, marsFile, marsSheetName, matchWork, parseMarsSheet, rowsToSync, splitContract, type MarsWork } from "./mars-sync";

const sheet: unknown[][] = [
  ["FATURAMENTO MARS 2026"],
  ["GESTÃO DE FATURAMENTO"],
  ["Nº Orç.", "N° PEDIDO", "CLIENTE", "CATEGORIA", "DESCRIÇÃO", "VALOR", "Nº NF", "DATA CONCLUSÃO"],
  ["Medição", "Enviar dia 15/10", "Beatriz", "Limpeza", "CONTRATO SANITATION - OUTUBRO", 188131.05, 1871, ""],
  ["26/540", 4500778184, "Luís", "Engenharia", "FECHAMENTO VAOS", 30000, 1863, ""],
  ["26/553", 4500778915, "Beatriz", "Saldo", "LIMPEZA AÉREA DRY", 8017, "", ""],
  ["26/540", 4500778184, "Luís", "Engenharia", "FECHAMENTO VAOS", 25001.85, "", ""],
  ["", "", "", "", "", 251150.9, "", ""],
  ["GESTÃO DE ORDENS DE SERVIÇOS"],
  ["Nº ORÇ.", "N° PEDIDO", "CLIENTE", "CATEGORIA", "DESCRIÇÃO", "VALOR", "STATUS", "RESPONSÁVEL", "PRAZO", "OBSERVAÇÃO"],
  ["Medição", "Medição", "Beatriz", "Limpeza", "CONTRATO SANITATION - NOVEMBRO", 188131.05, "Em execução", "", "", ""],
  ["26/506", 4500777849, "Natália", "Manutenção", "REPARO DOCA 2", 27952.48, "Já Realizado", "", "", "Pedido Cancelado"],
  ["26/540", 4500778184, "Luís", "Engenharia", "FECHAMENTO VAOS", 30000, "Aguardando execução", "Jacó", "", ""],
  ["26/580", "SEM", "João", "Andaime", "ANDAIME ROSCA 20", 10935.67, "Já realizado", "", "", ""],
  ["", "", "", "", "", 257019.2, "", ""],
];

describe("planilha da MARS", () => {
  it("arquivo e aba do mês", () => {
    expect(marsFile("2026-11")).toBe("Serviços/SERVIÇOS EXTERNOS/MARS MM/Faturamento MARS 2026.xlsx");
    expect(marsSheetName("2026-03")).toBe("2026 - Março");
  });
  it("lê as duas tabelas, contrato e cancelados", () => {
    const rows = parseMarsSheet(sheet);
    expect(rows.filter((r) => r.table === "faturamento")).toHaveLength(4);
    expect(rows.filter((r) => r.table === "ordens")).toHaveLength(4);
    expect(rows.filter((r) => r.contract).map((r) => r.table)).toEqual(["faturamento", "ordens"]);
    expect(rows.find((r) => r.quote === "26/506")?.cancelled).toBe(true);
    expect(rows.find((r) => r.quote === "26/580")?.order).toBeNull();
  });
  it("só ordens no dia a dia; na 1ª leitura também o faturamento, sem repetir o orçamento", () => {
    const rows = parseMarsSheet(sheet);
    expect(rowsToSync(rows, false).map((r) => r.key)).toEqual(["Q:26/540", "Q:26/580"]);
    const first = rowsToSync(rows, true);
    expect(first.map((r) => r.key)).toEqual(["Q:26/540", "Q:26/580", "Q:26/553"]);
    expect(first[0]!.value).toBe(30000);
  });
  it("acha o serviço pelo orçamento, pelo pedido ou Inbound", () => {
    const works: MarsWork[] = [
      { id: "a", name: "Base", quote_number: "26/484", orders: [{ number: "4500778184", value: 1 }] },
      { id: "b", name: "MARS MM - INBOUD", quote_number: null, orders: [] },
    ];
    const [r] = rowsToSync(parseMarsSheet(sheet), false);
    expect(matchWork(r!, works)?.id).toBe("a");
    expect(matchWork({ ...r!, quote: "Medição", order: "4800321760", description: "Carta de medição Inbound" }, works)?.id).toBe("b");
  });
  it("divide a medição do contrato na proporção do mês anterior, somando o total", () => {
    const works: MarsWork[] = [
      { id: "s", name: "Contrato Sanitation", quote_number: null, orders: [{ number: "4500777910", value: 80000, date: "2026-10-21" }] },
      { id: "a", name: "Adc - X", quote_number: null, orders: [{ number: "4500777910", value: 20000, date: "2026-10-21" }, { number: "999", value: 50, date: "2026-10-21" }] },
      { id: "o", name: "Outro", quote_number: null, orders: [{ number: "4500777910", value: 5, date: "2026-09-21" }] },
    ];
    const split = splitContract(works, "2026-11", 188131.05);
    expect(split.map((s) => s.id)).toEqual(["s", "a"]);
    expect(split.reduce((a, s) => a + s.value, 0)).toBeCloseTo(188131.05, 2);
    expect(split[0]!.value).toBeCloseTo(150504.84, 2);
    expect(contractMeasured(works, "2026-10")).toBe(true);
    expect(contractMeasured(works, "2026-11")).toBe(false);
  });
  it("andaime vai para o Contrato Andaimes", () => {
    expect(isScaffoldRow({ description: "MONTAGEM DE ANDAIME PARA TROCA DE SILOS" })).toBe(true);
    expect(isScaffoldRow({ description: "LIMPEZA DO SECADOR" })).toBe(false);
    expect(findScaffoldWork([{ id: "x", name: "Contrato Andaimes", quote_number: null, orders: [] }])?.id).toBe("x");
  });
});

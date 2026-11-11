import { describe, expect, it } from "vitest";
import { dayKm, dayToll, normalizePlate, parseFuel, parseMaintenance, vehicleMonth } from "./fleet-costs";

describe("manutenção da frota", () => {
  it("compara placas antigas e Mercosul", () => {
    expect(normalizePlate("FRE 2810")).toBe("FRE2I10");
    expect(normalizePlate("fre2i10")).toBe("FRE2I10");
    expect(normalizePlate("TEQ 3J19")).toBe("TEQ3J19");
    expect(normalizePlate("TICKET")).toBe("TICKET");
  });
  it("lê a planilha do Romildo pelo cabeçalho e usa o valor da OS", () => {
    const rows = [
      ["NF", "SÉRIE", "DT EMISSÃO", "CNPJ", "RAZÃO SOCIAL", "OS", "PLACA", " R$/OS ", "VALOR PAGO NO CARTÃO"],
      [1, "900", 45664, "x", "ROMILDO", 448, "FRE 2810", 1260, 7510],
      [2, "E", "28/01/2025", "x", "ROMILDO", 452, "FZZ 0A13", "R$ 750,00", 7510],
      ["", "", "", "", "", "", "", "", ""],
    ];
    expect(parseMaintenance(rows)).toEqual([
      { plate: "FRE2I10", date: "2025-01-07", amount: 1260, document: "NF 1 · OS 448", description: "Manutenção" },
      { plate: "FZZ0A13", date: "2025-01-28", amount: 750, document: "NF 2 · OS 452", description: "Manutenção" },
    ]);
  });
  it("lê a aba CONTROLE do posto com o cabeçalho fora da primeira linha", () => {
    const rows = [
      [], [],
      ["DATA", "DIA", "MÊS", "ANO", "QUINZENA", "Nº NF", "MOTORISTA", "PLACA", "VEÍCULO", "KM", "CÓDIGO TOTVS", "COMBUSTÍVEL", "QTD (L)", " R$/L ", " R$ TOTAL "],
      [46024, "", "", "", "1ª", 4859, "MAYCON", "TDJ 9B47", "ONIX", 31161, "CB00003", "GASOLINA COMUM", 7.983, 5.74, 45.82],
      [46024, "", "", "", "1ª", 4860, "X", "", "", 0, "", "", 0, 0, 10],
    ];
    expect(parseFuel(rows)).toEqual([{ plate: "TDJ9B47", date: "2026-01-02", amount: 45.82, document: "NF 4859", description: "GASOLINA COMUM · 7,98 L" }]);
  });
  it("km, pedágio e orçado × real do mês", () => {
    const s = { km: 100, trips: 2, extra_km: 10, clients: { has_toll: true, toll_amount: 5 } };
    expect(dayKm(s)).toBe(410);
    expect(dayToll(s)).toBe(20);
    expect(dayToll({ ...s, is_suzano_local: true })).toBe(0);
    expect(vehicleMonth(1000, 1500, 20, 800, 300, 100)).toEqual({ km: 1000, kmCost: 1350, budget: 1500, toll: 20, fuel: 800, maintenance: 300, rent: 100, real: 1220, diff: 280 });
  });
});

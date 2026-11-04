import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUSION_RULES, detectPurchaseAsset, effectivePurchaseCc, exclusionReason, filterPurchaseEntries, installmentPlan, purchaseItemKeys } from "./purchase-policy";

describe("exclusões em todos os clientes", () => {
  it.each(["VC00001", "VC00214", "SP00064", "SP00010", "RH00062"])("%s já está no km", (code) => expect(exclusionReason(code, DEFAULT_EXCLUSION_RULES)).toBe("Incluso no km rodado"));
  it("RH00043 já está no VT", () => expect(exclusionReason("RH00043", DEFAULT_EXCLUSION_RULES)).toBe("Incluso no VT"));
  it("RH00076 é passagem", () => expect(exclusionReason("RH00076", DEFAULT_EXCLUSION_RULES)).toBe("Passagem funcionário"));
  it.each(["RH00026", "RH00024", "RH00013", "RH00060", "RH00029", "RH00064", "RH00035"])("%s já está nos encargos", (code) => expect(exclusionReason(code, DEFAULT_EXCLUSION_RULES)).toBe("Incluso nos encargos"));
  it("permite desativar a regra", () => expect(exclusionReason("VC00214", DEFAULT_EXCLUSION_RULES.map((r) => ({ ...r, active: false })))).toBeNull());
});
describe("aquisições", () => {
  const item = (code: string, desc: string, amount = 20000) => ({ code, desc, amount, qty: 1 });
  it("Kombi 55000 é ativo antes da exclusão VC", () => expect(detectPurchaseAsset(item("VC00805", "VOLKSWAGEN KOMBI 2011/2012", 55000))).toBe("vehicle"));
  it("limite é inclusivo em 20000", () => { expect(detectPurchaseAsset(item("MF001", "COMPRESSOR", 20000))).toBe("equipment"); expect(detectPurchaseAsset(item("MF001", "COMPRESSOR", 19999.99))).toBeNull(); });
  it.each(["LOCAÇÃO PLATAFORMA ELEVATÓRIA", "SERVIÇOS DE SOLDA", "SERVIÇOS DE FRETES", "GAS GLP GRANEL", "SOMBRITE", "REMOVEDOR MXC-776", "MACACÃO TYVEK", "ENERGIA ELETRICA", "TINTA", "PEÇAS MOTOR"])("%s não é ativo", (desc) => expect(detectPurchaseAsset(item("XX001", desc, 55000))).toBeNull());
  it("12 parcelas de 55000 fecham centavos", () => { const p = installmentPlan(55000, "2026-10"); expect(p).toHaveLength(12); expect(p[0]).toEqual({ month: "2026-10", amount: 4583.33 }); expect(p[11]).toEqual({ month: "2027-09", amount: 4583.37 }); expect(p.reduce((s, x) => s + Math.round(x.amount * 100), 0)).toBe(5500000); });
  it("permite meses e valor editados", () => expect(installmentPlan(55000, "2026-10", 3, 20000).map((p) => p.amount)).toEqual([20000, 20000, 15000]));
  it("rejeita parcelas que ultrapassam o total", () => expect(() => installmentPlan(55000, "2026-10", 12, 5000)).toThrow());
  it("decisão continua identificada após mudar valor e reordenar", () => { const a = item("VC00805", "KOMBI", 55000); const b = item("MF001", "MOTOR", 22000); expect(purchaseItemKeys([a, b])[0]).toBe(purchaseItemKeys([b, { ...a, amount: 56000 }])[1]); });
});
describe("redirecionamentos de Americana", () => {
  const rules = ["2000002", "2000003"].map((source_cc) => ({ source_cc, target_cc: "2030999", active: true }));
  it.each(["2000002", "2000003"])("%s usa Suzano", (cc) => expect(effectivePurchaseCc(cc, rules, false)).toBe("2030999"));
  it("mantém direcionamento manual", () => expect(effectivePurchaseCc("2000002", rules, true)).toBe("2000002"));
});
describe("filtros de lançamentos", () => {
  const entries = [{ entry_date: "2026-10-01", category: "materiais", description: "Aquisição elétrica" }, { entry_date: "2026-10-31", category: "terceiros", description: "TRANSPORTE" }, { entry_date: "2026-09-30", category: "materiais", description: "aquisição" }];
  it("período inclusivo", () => expect(filterPurchaseEntries(entries, { from: "2026-10-01", to: "2026-10-31", category: "", description: "" })).toHaveLength(2));
  it("tipo Transporte inclui terceiros", () => expect(filterPurchaseEntries(entries, { from: "", to: "", category: "transporte", description: "" })).toEqual([entries[1]]));
  it("descrição ignora acentos e maiúsculas", () => expect(filterPurchaseEntries(entries, { from: "2026-10-01", to: "", category: "materiais", description: "AQUISICAO ELETRICA" })).toEqual([entries[0]]));
});
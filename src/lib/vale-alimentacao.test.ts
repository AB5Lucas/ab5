import { describe, expect, it } from "vitest";
import { computeVA, vaPaths, type VASettings } from "./vale-alimentacao";

const S: VASettings = { base_value: 200, tolerance_min: 15, pct1: 50, pct2: 70, pct3: 100, unjustified_reasons: ["FALTA INJUSTIFICADA"], justified_reasons: ["ATESTADO MEDICO", "AFASTAMENTO"], abono_reasons: ["ABONO", "DECLARAÇÃO DE HORAS"] };
const P = [{ id: "a", reg: "1", name: "Ana Silva" }];
const j = (date: string, reason: string) => ({ date, reg: "1", name: "Ana Silva", reason });
const late = (date: string, lateMin: number, discountMin = 20) => ({ date, name: "ANA SILVA", punches: ["07:20"], discountMin, lateMin, earlyMin: 0 });

describe("vale alimentação", () => {
  it("falta injustificada perde tudo", () => expect(computeVA(P, [j("2026-09-01", "FALTA INJUSTIFICADA")], [], S)[0]!.value).toBe(0));
  it("1 falta justificada perde 50%", () => expect(computeVA(P, [j("2026-09-01", "ATESTADO MEDICO")], [], S)[0]!.value).toBe(100));
  it("2 ocorrências perdem 70%", () => expect(computeVA(P, [j("2026-09-01", "AFASTAMENTO"), j("2026-09-02", "AFASTAMENTO")], [], S)[0]!.value).toBe(60));
  it("3 ocorrências perdem tudo", () => expect(computeVA(P, [j("2026-09-01", "AFASTAMENTO"), j("2026-09-02", "AFASTAMENTO")], [late("2026-09-03", 30)], S)[0]!.value).toBe(0));
  it("atraso abaixo de 15 min não conta", () => expect(computeVA(P, [], [late("2026-09-03", 14)], S)[0]!.late).toBe(0));
  it("atraso sem desconto no ponto não conta", () => expect(computeVA(P, [], [late("2026-09-03", 30, 0)], S)[0]!.late).toBe(0));
  it("atraso no sábado não conta", () => expect(computeVA(P, [], [late("2026-09-05", 30)], S)[0]!.late).toBe(0));
  it("abono no dia anula o atraso", () => expect(computeVA(P, [j("2026-09-03", "ABONO")], [late("2026-09-03", 30)], S)[0]!.late).toBe(0));
  it("pasta e arquivo seguem ano e mês", () => {
    expect(vaPaths("2026-09").folder.endsWith("/2026/092026/VA")).toBe(true);
    expect(vaPaths("2026-09").justificativa).toBe("Justificativa 26_08_2026 ate 25_09_2026.xlsx");
    expect(vaPaths("2027-01").justificativa).toBe("Justificativa 26_12_2026 ate 25_01_2027.xlsx");
  });
});

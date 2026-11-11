import { describe, expect, it } from "vitest";
import { laborShare, monthRange } from "./labor-share";

const works = new Map([
  ["w1", { client: "Suzano", clientKey: "c1", name: "Manutenção" }],
  ["w2", { client: "Suzano", clientKey: "c1", name: "Pintura" }],
  ["w3", { client: "Tenda", clientKey: "c2", name: "Obra" }],
]);
const rows = [
  { work_id: "w1", collaborator_id: "a", hours: 8 },
  { work_id: "w1", collaborator_id: "b", hours: 8 },
  { work_id: "w2", collaborator_id: "a", hours: 4 },
  { work_id: "w3", collaborator_id: "c", hours: 20 },
  { work_id: "w3", collaborator_id: "d", hours: 0 },
];

describe("rateio da MO", () => {
  it("por cliente soma os serviços do cliente e fecha 100%", () => {
    const r = laborShare(rows, works, "cliente");
    expect(r.map((x) => [x.label, x.hours, x.people, Math.round(x.pct)])).toEqual([["Suzano", 20, 2, 50], ["Tenda", 20, 1, 50]]);
    expect(r.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100);
  });
  it("por serviço separa cada serviço e ignora horas zeradas", () => {
    const r = laborShare(rows, works, "servico");
    expect(r.map((x) => [x.label, x.client, x.pct])).toEqual([["Obra", "Tenda", 50], ["Manutenção", "Suzano", 40], ["Pintura", "Suzano", 10]]);
  });
  it("mês inteiro, inclusive fevereiro", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

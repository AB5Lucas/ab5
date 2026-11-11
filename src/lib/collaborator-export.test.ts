import { describe, expect, it } from "vitest";
import { exportRows, orderedColumns } from "./collaborator-export";

const ctx = { names: new Map([["p1", "Pintor"]]), contractLabels: { efetivo: "Efetivo", pj: "PJ" } };
const rows = [{ registration_number: "10", full_name: "Ana Souza", position_id: "p1", status: "active", contract_type: "pj", hire_date: "2026-03-05", salary: 3000 }];

describe("exportar colaboradores", () => {
  it("usa a ordem escolhida e só as colunas marcadas", () => {
    const cols = orderedColumns(["position", "full_name"], false);
    expect(cols[0]!.key).toBe("position");
    expect(cols[1]!.key).toBe("full_name");
    expect(exportRows(rows, cols, new Set(["full_name", "position", "contract_type", "hire_date"]), ctx)).toEqual([
      ["Função", "Nome completo", "Tipo de contrato", "Data de admissão"],
      ["Pintor", "Ana Souza", "PJ", "05/03/2026"],
    ]);
  });
  it("salário só aparece para administrador", () => {
    expect(orderedColumns(null, false).some((c) => c.key === "salary")).toBe(false);
    expect(orderedColumns(null, true).some((c) => c.key === "salary")).toBe(true);
  });
});

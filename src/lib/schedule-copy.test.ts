import { describe, expect, it } from "vitest";
import { copyBoxes, copySkipReason, selectedCopyRows, type CopySkipChecks } from "./schedule-copy";

const rows = [
  { work_id: "a", works: { id: "a", name: "Serviço A", client_id: "industry", clients: { name: "Indústria" } } },
  { work_id: "b", works: { id: "b", name: "Serviço B", client_id: "industry", clients: { name: "Indústria" } } },
  { work_id: "c", works: { id: "c", name: "Serviço C", client_id: "coca", clients: { name: "Coca" } } },
];
describe("cópia de quadros", () => {
  it("todos os quadros com efetivo são selecionados por padrão", () => {
    const boxes = copyBoxes(rows);
    expect(boxes.map((b) => b.key)).toEqual(["coca", "industry"]);
    expect(selectedCopyRows(rows, new Set(boxes.map((b) => b.key)))).toHaveLength(3);
  });
  it("copia apenas os quadros marcados incluindo seus serviços", () => {
    expect(selectedCopyRows(rows, new Set(["industry"])).map((r) => r.work_id)).toEqual(["a", "b"]);
    expect(selectedCopyRows(rows, new Set())).toEqual([]);
  });
});
describe("copySkipReason", () => {
  const none: CopySkipChecks = { absence: () => null, appointment: () => null, docs: () => [], box: () => null, noticeEnded: () => null };
  const row = { work_id: "w", collaborator_id: "p" };
  it("pode copiar sem impedimento", () => expect(copySkipReason(row, none)).toBeNull());
  it("motivos na ordem da Programação", () => {
    expect(copySkipReason(row, { ...none, absence: () => "Férias", box: () => "FOLGAS" })).toBe("ausência (férias)");
    expect(copySkipReason(row, { ...none, appointment: () => "Exame ASO" })).toBe("agendamento (Exame ASO)");
    expect(copySkipReason(row, { ...none, box: () => "TREINAMENTO" })).toBe("quadro TREINAMENTO");
    expect(copySkipReason(row, { ...none, noticeEnded: () => "10/11/2026" })).toBe("aviso prévio terminou em 10/11/2026");
    expect(copySkipReason(row, { ...none, docs: () => ["NR-35 vencida em 01/11/2026"] })).toBe("ASO/treinamento: NR-35 vencida em 01/11/2026");
  });
});

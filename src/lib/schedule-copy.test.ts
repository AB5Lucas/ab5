import { describe, expect, it } from "vitest";
import { copyBoxes, selectedCopyRows } from "./schedule-copy";

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
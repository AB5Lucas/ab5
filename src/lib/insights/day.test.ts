import { describe, expect, it } from "vitest";
import { absencesByDay, dayPulse, rdoTiles, restStreaks } from "./day";

const D = "2026-11-24";

describe("pulso do dia", () => {
  it("cada pessoa numa situação, na ordem de prioridade", () => {
    const p = dayPulse({
      allocations: [{ collaborator_id: "a" }, { collaborator_id: "b" }, { collaborator_id: "a" }],
      boxes: [{ collaborator_id: "c", box_key: "treinamento" }, { collaborator_id: "d", box_key: "folga" }, { collaborator_id: "e", box_key: "falta" }, { collaborator_id: "f", box_key: "integracao:x" }],
      appointments: [{ collaborator_id: "b" }, { collaborator_id: "g" }],
      vacations: [{ collaborator_id: "h" }],
      medical: [{ collaborator_id: "i" }, { collaborator_id: "d" }],
      daysOff: [{ collaborator_id: "j" }],
    });
    expect(p.total).toBe(10);
    expect(p.counts).toEqual({ obra: 2, compromisso: 3, ferias: 1, atestado: 2, folga: 1, outros: 1 });
    expect(p.status.get("d")).toBe("atestado");
  });
});

describe("RDOs do dia", () => {
  it("um quadrado por serviço com equipe, cor pelo RDO", () => {
    const t = rdoTiles(
      [{ collaborator_id: "a", work_id: "w1" }, { collaborator_id: "b", work_id: "w1" }, { collaborator_id: "c", work_id: "w2" }, { collaborator_id: "d", work_id: "w3" }],
      [{ work_id: "w1", status: "finalized" }, { work_id: "w2", status: "draft" }, { work_id: "w9", status: "draft" }],
      new Map([["w1", { name: "A", clientName: "X" }], ["w2", { name: "B", clientName: "X" }], ["w3", { name: "C", clientName: "Y" }]]),
    );
    expect(t.map((x) => [x.workId, x.status, x.people])).toEqual([["w1", "final", 2], ["w2", "draft", 1], ["w3", "none", 1]]);
  });
});

describe("dias seguidos sem folga", () => {
  const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"];
  it("conta para trás até faltar escala ou ter ausência", () => {
    const worked = new Map(days.map((d) => [d, new Set(["a", "b", "c"])]));
    worked.get("2026-11-20")!.delete("b"); // b sem escala na sexta
    const absent = absencesByDay("2026-11-04", D, [{ collaborator_id: "c", start: "2026-11-21", end: null }]);
    const s = restStreaks(D, worked, absent, 4);
    expect(s).toEqual([{ collaboratorId: "a", days: 9, since: "2026-11-16" }, { collaboratorId: "b", days: 4, since: "2026-11-21" }]);
    expect(restStreaks(D, worked, absent, 6).map((x) => x.collaboratorId)).toEqual(["a"]);
  });
  it("ausências por dia a partir de intervalos", () => {
    const m = absencesByDay("2026-11-20", "2026-11-24", [{ collaborator_id: "x", start: "2026-11-18", end: "2026-11-21" }]);
    expect([...m.keys()]).toEqual(["2026-11-20", "2026-11-21"]);
  });
});

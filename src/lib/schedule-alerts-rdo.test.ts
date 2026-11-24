import { describe, expect, it } from "vitest";
import { previousBusinessDay, rdoDivergences, scheduleAlerts, type AlertData } from "./schedule-alerts";

const base = (over: Partial<AlertData> = {}): AlertData => ({
  date: "2026-11-16", today: "2026-11-16", now: new Date("2026-11-16T12:00:00Z"), holidays: new Set(), scheduleExists: true,
  allocations: [], prevAllocations: [],
  works: new Map([
    ["w1", { id: "w1", name: "Obra", client_id: "c1", entry_time: "07:00:00", exit_time: "17:00:00", exit_time_weekend: null, night_shift: false }],
    ["w2", { id: "w2", name: "Outra", client_id: "c1", entry_time: "07:00:00", exit_time: "17:00:00", exit_time_weekend: null, night_shift: false }],
    ["g1", { id: "g1", name: "RDO Geral", client_id: "c1", entry_time: null, exit_time: null, exit_time_weekend: null, night_shift: false, rdo_general: true }],
    ["ind", { id: "ind", name: "Fábrica", client_id: "cI", entry_time: null, exit_time: null, exit_time_weekend: null, night_shift: false }],
  ]),
  clients: new Map([["c1", { name: "YARA", needs_company_transport: false }], ["cI", { name: "INDÚSTRIA", needs_company_transport: false }]]),
  people: new Map([["p1", { name: "Beto", position: null, cnh: null, active: true }], ["p2", { name: "Caio", position: null, cnh: null, active: true }], ["p3", { name: "Dani", position: null, cnh: null, active: true }]]),
  vehicles: [], appointments: [], covered: new Set(), asos: [], integrations: [], trainings: [], accounted: new Set(), recent: new Set(),
  ...over,
});
const find = (d: AlertData, key: string) => scheduleAlerts(d).find((a) => a.key === key);

describe("avisos de ausência, distribuição e RDO", () => {
  it("V14: escalado com ausência no dia, com ação de tirar da obra", () => {
    const a = find(base({
      allocations: [{ id: "a1", collaborator_id: "p1", work_id: "w1" }, { id: "a2", collaborator_id: "p2", work_id: "w1" }],
      absences: new Map([["p1", "Atestado"]]),
    }), "v14");
    expect(a?.tone).toBe("red");
    expect(a?.people).toEqual(["Beto · Atestado · YARA"]);
    expect(a?.action).toEqual({ kind: "remove_allocations", ids: ["a1"] });
    expect(find(base({ allocations: [{ id: "a2", collaborator_id: "p2", work_id: "w1" }], absences: new Map([["p1", "Folga"]]) }), "v14")).toBeUndefined();
  });

  it("L7: distribuição pendente só no próximo dia útil e nunca a Indústria", () => {
    const d = { today: "2026-11-13", date: "2026-11-16", distributionPending: ["YARA", "Indústria"] };
    expect(find(base(d), "l7")?.people).toEqual(["YARA"]);
    expect(find(base({ ...d, date: "2026-11-17" }), "l7")).toBeUndefined();
    expect(find(base({ ...d, distributionPending: ["INDUSTRIA"] }), "l7")).toBeUndefined();
  });

  it("dia útil anterior pula fim de semana e feriado", () => {
    expect(previousBusinessDay("2026-11-16", new Set())).toBe("2026-11-13");
    expect(previousBusinessDay("2026-11-17", new Set(["2026-11-16"]))).toBe("2026-11-13");
  });

  it("L8: RDO não criado ou não finalizado no dia útil anterior (RDO Geral cobre; sem a Indústria)", () => {
    const prevRdo = { date: "2026-11-13", workIds: ["w1", "w2", "ind"], rdos: [{ work_id: "w1", status: "draft" }], usesRdo: new Set(["c1", "cI"]) };
    expect(find(base({ prevRdo }), "l8")?.people).toEqual(["YARA - Obra · não finalizado", "YARA - Outra · sem RDO"]);
    expect(find(base({ prevRdo: { ...prevRdo, rdos: [{ work_id: "w1", status: "finalized" }, { work_id: "g1", status: "finalized" }] } }), "l8")).toBeUndefined();
    // Cliente que não usa RDO não é cobrado.
    expect(find(base({ prevRdo: { ...prevRdo, usesRdo: new Set() } }), "l8")).toBeUndefined();
    // Dia ainda não passou: sem aviso.
    expect(find(base({ prevRdo: { ...prevRdo, date: "2026-11-16" } }), "l8")).toBeUndefined();
  });

  it("L9: ocorrência sem classificação só a partir do dia 20", () => {
    const pendingOccurrences = [{ collaborator_id: "p1", report_date: "2026-11-12", work_id: "w1", reason: "falta" }];
    expect(find(base({ pendingOccurrences }), "l9")).toBeUndefined();
    expect(find(base({ date: "2026-11-20", pendingOccurrences }), "l9")?.people).toEqual(["Beto · 12/11 · YARA · falta"]);
  });

  it("L6: RDO finalizado diverge da programação", () => {
    const d = base({
      allocations: [{ collaborator_id: "p1", work_id: "w1" }, { collaborator_id: "p2", work_id: "w1" }, { collaborator_id: "p3", work_id: "w1" }],
      absences: new Map([["p3", "Férias"]]),
      finalizedRdos: [{ work_id: "w1", workforce: ["p1"], present: ["p1"] }],
    });
    expect(find(d, "l6")?.people).toEqual(["YARA - Obra · escalados fora do RDO: Caio"]);
    // Ausência informada no RDO (presente = não) conta como efetivo; integração lançada no serviço é planejada.
    expect(rdoDivergences({ ...d, finalizedRdos: [{ work_id: "w1", workforce: ["p1", "p2"], present: ["p1"] }] })).toEqual([]);
    expect(rdoDivergences({ ...d, allocations: [], finalizedRdos: [{ work_id: "w1", workforce: ["p1"], present: ["p1"] }], integrationChoices: [{ work_id: "w1", collaborator_id: "p1" }] })).toEqual([]);
    // RDO Geral reúne os serviços do cliente.
    expect(rdoDivergences({ ...d, finalizedRdos: [{ work_id: "g1", workforce: ["p1", "p2", "p9"], present: ["p1", "p2", "p9"] }], people: new Map([...d.people, ["p9", { name: "Edu", position: null, cnh: null, active: true }]]) }))
      .toEqual(["YARA - RDO Geral · no RDO sem escalação: Edu"]);
  });
});

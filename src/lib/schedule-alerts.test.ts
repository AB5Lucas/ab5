import { describe, expect, it } from "vitest";
import { nextBusinessDay, pastCutoff, scheduleAlerts, type AlertData } from "./schedule-alerts";

const base = (over: Partial<AlertData> = {}): AlertData => ({
  date: "2026-11-16", today: "2026-11-13", now: new Date("2026-11-13T12:00:00Z"), holidays: new Set(), scheduleExists: true,
  allocations: [], prevAllocations: [],
  works: new Map([
    ["adm", { id: "adm", name: "Adm", client_id: "cADM", entry_time: "07:00:00", exit_time: "17:00:00", exit_time_weekend: "16:00:00", night_shift: false }],
    ["w1", { id: "w1", name: "Obra", client_id: "c1", entry_time: "07:00:00", exit_time: "17:00:00", exit_time_weekend: null, night_shift: false }],
    ["n1", { id: "n1", name: "Noturno", client_id: "c1", entry_time: "22:00:00", exit_time: "06:00:00", exit_time_weekend: null, night_shift: true }],
  ]),
  clients: new Map([["cADM", { name: "ADM", needs_company_transport: false }], ["c1", { name: "YARA", needs_company_transport: true }]]),
  people: new Map([["tst", { name: "Ana", position: "Técnico de Segurança do Trabalho", cnh: null, active: true }], ["p1", { name: "Beto", position: "Pedreiro", cnh: "2026-01-01", active: true }], ["p2", { name: "Caio", position: "Pintor", cnh: null, active: true }]]),
  vehicles: [], appointments: [], covered: new Set(), asos: [], integrations: [], trainings: [], accounted: new Set(), recent: new Set(),
  ...over,
});
const keys = (d: AlertData) => scheduleAlerts(d).map((a) => a.key);

describe("avisos da programação", () => {
  it("próximo dia útil e horário de corte", () => {
    expect(nextBusinessDay("2026-11-13", new Set())).toBe("2026-11-16");
    expect(nextBusinessDay("2026-11-13", new Set(["2026-11-16"]))).toBe("2026-11-17");
    expect(pastCutoff(new Date("2026-11-12T18:59:00Z"))).toBe(false); // qui 15:59
    expect(pastCutoff(new Date("2026-11-12T19:00:00Z"))).toBe(true); // qui 16:00
    expect(pastCutoff(new Date("2026-11-13T18:00:00Z"))).toBe(true); // sex 15:00
  });
  it("V11 só para o próximo dia útil, depois do corte", () => {
    expect(keys(base({ scheduleExists: false }))).not.toContain("v11");
    expect(keys(base({ scheduleExists: false, now: new Date("2026-11-13T18:30:00Z") }))).toContain("v11");
  });
  it("V1 treinamento sem TST no ADM", () => {
    const appt = [{ collaborator_id: "p2", type: "treinamento", status: "agendado", client_booked: true, label: "treinamento NR-35" }];
    expect(keys(base({ appointments: appt }))).toContain("v1");
    expect(keys(base({ appointments: appt, allocations: [{ collaborator_id: "tst", work_id: "adm" }] }))).not.toContain("v1");
  });
  it("V8 e V9 transporte", () => {
    const d = base({ allocations: [{ collaborator_id: "p2", work_id: "w1" }], vehicles: [{ plate: "ABC1234", driver_id: "p1", extra_driver_ids: [], client_id: "cADM", extra_client_ids: [], is_maintenance: false, is_external: false }, { plate: "XYZ", driver_id: null, extra_driver_ids: [], client_id: "c1", extra_client_ids: [], is_maintenance: false, is_external: false }] });
    expect(keys(d)).toEqual(expect.arrayContaining(["v8a", "v8b"]));
    expect(keys(d)).not.toContain("v9");
    expect(keys(base({ allocations: [{ collaborator_id: "p2", work_id: "w1" }] }))).toContain("v9");
    expect(keys(base({ allocations: [{ collaborator_id: "p2", work_id: "w1", vt: true }] }))).not.toContain("v9");
    expect(keys(base({ allocations: [{ collaborator_id: "p2", work_id: "w1" }], builtTransport: new Set(["c1"]) }))).not.toContain("v9");
  });
  it("V10 descanso menor que 11h depois do noturno", () => {
    const d = base({ allocations: [{ collaborator_id: "p2", work_id: "adm" }], prevAllocations: [{ collaborator_id: "p2", work_id: "n1" }] });
    expect(keys(d)).toContain("v10");
    expect(keys(base({ allocations: [{ collaborator_id: "p2", work_id: "adm" }], prevAllocations: [{ collaborator_id: "p2", work_id: "w1" }] }))).not.toContain("v10");
  });
  it("L1, L2 e L5", () => {
    const d = base({
      allocations: [{ collaborator_id: "p2", work_id: "adm" }],
      asos: [{ collaborator_id: "p2", expires_at: "2026-11-20" }],
      appointments: [{ collaborator_id: "p1", type: "integracao", status: "agendado", client_booked: false, label: "integração YARA" }, { collaborator_id: "p1", type: "aso", status: "agendado", client_booked: false, label: "ASO" }],
      recent: new Set(["p2", "tst", "p1"]), accounted: new Set(["p1"]),
    });
    const a = scheduleAlerts(d);
    expect(a.map((x) => x.key)).toEqual(expect.arrayContaining(["l1", "l2", "l5"]));
    expect(a.find((x) => x.key === "l5")!.people).toEqual(["Ana"]);
    expect(a.find((x) => x.key === "l2")!.people).toEqual(["Beto · integração YARA"]);
    expect(keys({ ...d, covered: new Set(["aso|p2"]) })).not.toContain("l1");
    const pj = new Map(d.people); pj.set("tst", { ...pj.get("tst")!, contract: "intermitente" });
    expect(keys({ ...d, people: pj })).not.toContain("l5");
  });
});

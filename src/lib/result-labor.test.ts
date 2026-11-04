import { describe, expect, it } from "vitest";
import { resultHours, marginPercent, supportDailyWeights, supportShare, meanMarginPercent } from "./result-labor";
import { buildBase, sliceResultRaw } from "./results-engine";

const empty = { allocs: [], sibAllocs: [], sibRdo: [], rdoWf: [], entries: [], progress: [], people: [], vs: [], client: {}, workVt: [], workTravelRows: [], noVtRows: [], leaves: [], vtRules: [], dbRules: [], tbRules: [], cityDist: [], integAppts: [], integBoxes: [], monthlyIds: [], nightIds: [], siblingCount: 2 };
const alloc = (id: string, work_id: string, date = "2026-10-27") => ({ collaborator_id: id, work_id, schedule_id: date, daily_schedules: { schedule_date: date }, vt_override: true, travel_bonus_override: true });
const works = [{ id: "a", monthly_enabled: true, orders: [{ date: "2026-10-01", value: 10000 }] }, { id: "b", monthly_enabled: true, orders: [{ date: "2026-10-01", value: 10000 }] }];
const calc = (raw: any, id = "a") => buildBase(works.find((w) => w.id === id), sliceResultRaw(raw, id), "2026-10", "2026-10", { isAll: false, workIds: [id], holidays: [], allWorks: works });
describe("escala sem linha no RDO existente", () => {
  it("Marcelo em 27–30/10: remove 32h e respectivos custos/VT/prêmio", () => {
    const allocs = [27, 28, 29, 30].map((d) => alloc("marcelo", "a", `2026-10-${d}`));
    const raw = { ...empty, allocs, sibAllocs: allocs, people: [{ id: "marcelo", full_name: "Marcelo", salary: 10 }], clientRdos: allocs.map((a) => ({ work_id: "b", report_date: a.daily_schedules.schedule_date })), vtRules: [{ amount: 5, applies_to_collaborators: true }], tbRules: [{ bonus_amount: 25, minimum_distance: 0, maximum_distance: null }] };
    const b = calc(raw);
    expect(b?.tot.labor).toBe(0);
    expect(b?.vtTotal).toBe(0);
    expect(b?.travelTotal).toBe(0);
    expect(b?.missingRdo.reduce((s, r) => s + r.removedHours, 0)).toBe(32);
    expect(b?.missingRdo.reduce((s, r) => s + r.removedCost, 0)).toBe(832);
  });
  it("mantém 8h exclusivamente sem RDO do cliente", () => { expect(resultHours(null, false)).toBe(8); expect(resultHours(null, true)).toBe(0); expect(resultHours({ present: false, worked_hours: 8 }, true)).toBe(0); });
  it("linha presente em RDO de serviço irmão prevalece", () => {
    const a = alloc("p", "a");
    expect(calc({ ...empty, allocs: [a], sibAllocs: [a], people: [{ id: "p", salary: 10 }], sibRdo: [{ work_id: "b", collaborator_id: "p", report_date: "2026-10-27", present: true, worked_hours: 6 }] })?.tot.labor).toBe(156);
  });
});
describe("margem sem receita", () => {
  it("custo de 100 sem receita mantém −100 e percentual indefinido", () => {
    const w = { id: "a", monthly_enabled: true, orders: [] };
    const b = buildBase(w, { ...empty, entries: [{ work_id: "a", category: "materiais", amount: 100, entry_date: "2026-10-27" }] }, "2026-10", "2026-10", { isAll: false, workIds: ["a"], holidays: [], allWorks: [w] });
    expect(b?.last?.margin).toBe(-100); expect(b?.last?.marginPct).toBeNull();
  });
  it("margem negativa nunca fica positiva nem vira zero na média", () => { expect(marginPercent(-100, 1000)).toBe(-10); expect(meanMarginPercent([50, -10], -100)).toBeNull(); expect(marginPercent(0, 1000)).toBe(0); });
});
describe("apoio diário incluindo mensais", () => {
  it("distribui MO, VT e viagem 75/25 pelas horas dos demais e preserva total", () => {
    const allocs = [alloc("support", "a"), alloc("p1", "a"), alloc("p2", "b")];
    const rdos = [{ collaborator_id: "support", work_id: "a", report_date: "2026-10-27", present: true, worked_hours: 8 }, { collaborator_id: "p1", work_id: "a", report_date: "2026-10-27", present: true, worked_hours: 6 }, { collaborator_id: "p2", work_id: "b", report_date: "2026-10-27", present: true, worked_hours: 2 }];
    const raw = { ...empty, allocs, sibAllocs: allocs, rdoWf: rdos, sibRdo: rdos, supportIds: ["support"], people: [{ id: "support", salary: 10 }, { id: "p1", salary: 0 }, { id: "p2", salary: 0 }], vtRules: [{ amount: 4, applies_to_collaborators: true }], tbRules: [{ bonus_amount: 20, minimum_distance: 0, maximum_distance: null }] };
    const a = calc(raw, "a"), b = calc(raw, "b");
    expect(a?.tot.labor).toBe(156); expect(b?.tot.labor).toBe(52); expect((a?.tot.labor ?? 0) + (b?.tot.labor ?? 0)).toBe(208);
    expect(a?.vtTotal).toBe(7); expect(b?.vtTotal).toBe(5);
    expect(a?.travelTotal).toBe(35); expect(b?.travelTotal).toBe(25);
  });
  it("sem RDO usa 8h de escalação, nunca exclui mensais; dia único recebe 100%", () => {
    const m = supportDailyWeights([alloc("s", "a"), alloc("p", "b")], [], [], new Set(["s"]));
    expect(supportShare(m, "2026-10-27", "a", new Set(["b"]))).toBe(1);
    expect(supportShare(m, "2026-10-27", "a", new Set(["a"]))).toBe(0);
  });
  it("sem base conserva o destino da escalação", () => expect(supportShare(new Map(), "2026-10-27", "a", new Set(["a"]))).toBe(1));
  it("usa o serviço registrado no RDO como peso e mantém marcação de viagem do serviço de origem ao fatiar lotes", () => {
    const allocations = [alloc("s", "a"), alloc("p", "a")];
    const rdos = [{ collaborator_id: "p", work_id: "b", report_date: "2026-10-27", present: true, worked_hours: 6 }, { collaborator_id: "s", work_id: "a", report_date: "2026-10-27", present: true, worked_hours: 8 }];
    const weights = supportDailyWeights(allocations, rdos, [], new Set(["s"]));
    expect(supportShare(weights, "2026-10-27", "a", new Set(["b"]))).toBe(1);
    const raw = { ...empty, allocs: allocations.map((a) => ({ ...a, travel_bonus_override: null })), sibAllocs: allocations.map((a) => ({ ...a, travel_bonus_override: null })), sibRdo: rdos, supportIds: ["s"], workTravelRows: [{ work_id: "a", schedule_id: "2026-10-27", pays_bonus: false }], people: [{ id: "s", salary: 10 }, { id: "p", salary: 0 }], tbRules: [{ bonus_amount: 20, minimum_distance: 0, maximum_distance: null }] };
    expect(calc(raw, "b")?.travelTotal).toBe(0);
  });
  it("dias com pesos invertidos usam proporções diárias e não a média mensal", () => {
    const allocations = [alloc("p1", "a"), alloc("p2", "b"), alloc("p1", "a", "2026-10-28"), alloc("p2", "b", "2026-10-28")];
    const rdos = allocations.map((a, i) => ({ collaborator_id: a.collaborator_id, work_id: a.work_id, report_date: a.daily_schedules.schedule_date, present: true, worked_hours: [6, 2, 2, 6][i] }));
    const weights = supportDailyWeights(allocations, rdos, [], new Set());
    expect(supportShare(weights, "2026-10-27", "a", new Set(["a"]))).toBe(0.75);
    expect(supportShare(weights, "2026-10-28", "a", new Set(["a"]))).toBe(0.25);
  });
});
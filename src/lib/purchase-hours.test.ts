import { describe, expect, it } from "vitest";
import { purchaseMonthHours } from "./purchase-hours";
const works = [{ id: "batatas", client_id: "tc" }, { id: "yokitos", client_id: "tc" }, { id: "patio", client_id: "other" }];
const alloc = (work_id: string, date = "2026-10-01") => ({ work_id, collaborator_id: "p", daily_schedules: { schedule_date: date } });
const row = (work_id: string, worked_hours = 6) => ({ work_id, collaborator_id: "p", report_date: "2026-10-01", present: true, worked_hours });
describe("horas de Compras dia a dia", () => {
  it("folga exclui 8h de escala e RDO conflitante da base de rateio", () => {
    const absences = { daysOff: [{ collaborator_id: "p", date: "2026-10-01", end_date: null }] };
    expect(purchaseMonthHours(works, [alloc("batatas")], [], [], [], absences).get("batatas") ?? 0).toBe(0);
    expect(purchaseMonthHours(works, [alloc("batatas")], [row("batatas")], [], [], absences).get("batatas") ?? 0).toBe(0);
    expect(purchaseMonthHours(works, [alloc("batatas", "2026-10-02")], [], [], [], absences).get("batatas")).toBe(8);
  });
  it("usa RDO do mesmo cliente sem perder 8h dos demais dias", () => expect(purchaseMonthHours(works, [alloc("batatas"), alloc("batatas", "2026-10-02")], [row("yokitos")], []).get("batatas")).toBe(14));
  it("RDO em outro cliente não duplica as horas na escala", () => { const h = purchaseMonthHours(works, [alloc("batatas")], [row("patio")], []); expect(h.get("batatas") ?? 0).toBe(0); expect(h.get("patio")).toBe(6); });
  it("RDO do próprio serviço sem a pessoa zera", () => expect(purchaseMonthHours(works, [alloc("batatas")], [], [{ work_id: "batatas", report_date: "2026-10-01" }]).get("batatas") ?? 0).toBe(0));
  it("RDO de serviço irmão não remove o padrão 8h", () => expect(purchaseMonthHours(works, [alloc("batatas")], [], [{ work_id: "yokitos", report_date: "2026-10-01" }]).get("batatas")).toBe(8));
  it("apoio preserva total e segue horas dos demais", () => { const a = [alloc("batatas"), { ...alloc("yokitos"), collaborator_id: "q" }, { ...alloc("batatas"), collaborator_id: "support" }]; const h = purchaseMonthHours(works, a, [], [], [{ client_id: "tc", collaborator_id: "support" }]); expect(h.get("batatas")).toBe(12); expect(h.get("yokitos")).toBe(12); });
});
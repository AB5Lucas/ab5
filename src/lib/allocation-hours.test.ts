import { describe, expect, it } from "vitest";
import { allocationHours, type AllocationHourInput } from "./allocation-hours";

const allocation = (date: string): AllocationHourInput => ({ collaborator_id: "person", collaborators: { full_name: "Pessoa" }, daily_schedules: { schedule_date: date }, works: { id: "work", entry_time: "07:00", exit_time: "17:00", exit_time_weekend: "16:00", night_shift: false } });
describe("horas de alocações", () => {
  it("usa o horário do dia sem RDO", () => {
    expect(allocationHours([allocation("2026-10-29"), allocation("2026-10-30"), allocation("2026-10-31"), allocation("2026-11-01")], [], []).map(r => r.hours)).toEqual([9, 8, 8, 8]);
  });
  it("prioriza as horas do RDO, sem somar a jornada padrão", () => {
    const record = { work_id: "work", collaborator_id: "person", name: "Pessoa", date: "2026-10-30", hours: 6 };
    expect(allocationHours([allocation(record.date)], [record], [{ work_id: "work", report_date: record.date }])).toEqual([record]);
  });
  it("não estima horas para ausente nem para pessoa não registrada num dia com RDO", () => {
    const absent = { work_id: "work", collaborator_id: "person", name: "Pessoa", date: "2026-10-30", hours: 0 };
    expect(allocationHours([allocation(absent.date)], [absent], [{ work_id: "work", report_date: absent.date }])[0]?.hours).toBe(0);
    expect(allocationHours([allocation(absent.date)], [], [{ work_id: "work", report_date: absent.date }])).toEqual([]);
  });
  it("não duplica a mesma escalação e respeita jornada noturna", () => {
    const a = allocation("2026-10-30");
    if (a.works) a.works.night_shift = true;
    expect(allocationHours([a, a], [], []).map(r => r.hours)).toEqual([7]);
  });
});
import { describe, expect, it } from "vitest";
import { filteredDailyAllocations } from "./allocation-daily-pdf";

describe("filtered daily PDF rows", () => {
  it("exports only the selected collaborator in the displayed date order without changing source rows", () => {
    const rows = [
      { id: "later", collaborator_id: "selected", daily_schedules: { schedule_date: "2026-11-03" } },
      { id: "other", collaborator_id: "other", daily_schedules: { schedule_date: "2026-11-02" } },
      { id: "earlier", collaborator_id: "selected", daily_schedules: { schedule_date: "2026-11-01" } },
    ];
    expect(filteredDailyAllocations(rows, "selected").map((row) => row.id)).toEqual(["earlier", "later"]);
    expect(rows.map((row) => row.id)).toEqual(["later", "other", "earlier"]);
  });
});
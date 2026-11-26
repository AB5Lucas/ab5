import { expect, it } from "vitest";
import { fleetDashboardCosts } from "./fleet-dashboard-costs";

const vehicles = [{ id: "a", plate: "AAA1A11", ownership: "proprio", monthly_rent: null }, { id: "b", plate: "BBB2B22", ownership: "alugado", monthly_rent: 3000 }];
const schedules = [{ vehicle_id: "a", schedule_date: "2026-11-01", km: 10, trips: 1 }, { vehicle_id: "b", schedule_date: "2026-11-02", km: 30, trips: 1 }];
it("one day compares each vehicle with the monthly km weight and daily rent", () => {
  const rows = fleetDashboardCosts(vehicles, schedules, [], new Map([["2026-11", 12000]]), ["2026-11-01"], true);
  expect(rows).toEqual([{ label: "AAA1A11", a: 100, b: 0 }, { label: "BBB2B22", a: 300, b: 100 }]);
});
it("multiple days split the monthly budget by the km driven each day", () => {
  const rows = fleetDashboardCosts(vehicles, schedules, [{ plate: "AAA1A11", expense_date: "2026-11-02", amount: 75 }], new Map([["2026-11", 12000]]), ["2026-11-01", "2026-11-02"], false);
  expect(rows).toEqual([{ label: "01/11", a: 3000, b: 100 }, { label: "02/11", a: 9000, b: 175 }]);
});it("month without km falls back to an even daily budget", () => {
  const rows = fleetDashboardCosts(vehicles, [], [], new Map([["2026-11", 12000]]), ["2026-11-01"], false);
  expect(rows[0]!.a).toBe(400);
});

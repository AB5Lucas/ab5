import { describe, expect, it } from "vitest";
import { fleetRankingPeriod } from "./fleet-ranking-period";

describe("fleet ranking period", () => {
  it("always includes the last 30 days, including today", () => {
    expect(fleetRankingPeriod("2026-11-25")).toEqual({ from: "2026-10-27", to: "2026-11-25" });
    expect(fleetRankingPeriod("2027-01-05")).toEqual({ from: "2026-12-07", to: "2027-01-05" });
  });
});
import { describe, expect, it } from "vitest";
import { balanceBadgeTone, balanceTone, fleetBalance } from "./fleet-balance";

describe("fleet balance", () => {
  it("40k menos faturas em aberto menos o período", () => {
    expect(fleetBalance(12000.5, 25000.25)).toBe(2999.25);
  });
  it("cores do número e do aviso", () => {
    expect(balanceTone(3000)).toBe("warn");
    expect(balanceTone(1000)).toBe("bad");
    expect(balanceTone(3000.01)).toBeUndefined();
    expect(balanceBadgeTone(2999)).toBe("orange");
    expect(balanceBadgeTone(999)).toBe("red");
    expect(balanceBadgeTone(3000)).toBeUndefined();
  });
});

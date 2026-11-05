import { describe, expect, it, vi } from "vitest";
vi.mock("jspdf", () => ({ jsPDF: class {} }));
vi.mock("@/assets/ab5-logo.png.asset.json", () => ({ default: { url: "" } }));
import { periodStart, periodText, trainingDays } from "./certificates";

describe("período do certificado", () => {
  it("até 8h é 1 dia; acima usa 8h por dia", () => {
    expect(trainingDays(8)).toBe(1);
    expect(trainingDays(16)).toBe(2);
    expect(trainingDays(20)).toBe(3);
    expect(trainingDays(40)).toBe(5);
  });
  it("retroage dias úteis a partir do último dia", () => {
    expect(periodStart("2026-11-05", 2)).toBe("2026-11-04"); // qui -> qua
    expect(periodStart("2026-11-09", 2)).toBe("2026-11-06"); // seg -> sex
    expect(periodStart("2026-11-05", 1)).toBe("2026-11-05");
  });
  it("texto usa período quando há mais de um dia", () => {
    expect(periodText("2026-11-04", "2026-11-05")).toBe("no período de 04/11/2026 a 05/11/2026");
    expect(periodText(null, "2026-11-05")).toBe("no dia 05/11/2026");
  });
});

import { describe, expect, it } from "vitest";
import { effectiveCity, lodgingBlocksBenefits, lodgingOn } from "./lodging";

const stays = [
  { collaborator_id: "a", lodging: "americana", start_date: "2026-11-10", end_date: "2026-11-20" },
  { collaborator_id: "a", lodging: "mogi_guacu", start_date: "2026-11-21", end_date: null },
];
describe("alojamento", () => {
  it("alojamento por dia", () => {
    expect(lodgingOn(stays, "a", "2026-11-09")).toBeNull();
    expect(lodgingOn(stays, "a", "2026-11-15")).toBe("americana");
    expect(lodgingOn(stays, "a", "2026-12-01")).toBe("mogi_guacu");
  });
  it("regras", () => {
    expect(lodgingBlocksBenefits("americana", "SUZANO")).toBe(true);
    expect(lodgingBlocksBenefits("americana", "MARS MM")).toBe(false);
    expect(lodgingBlocksBenefits("mogi_guacu", "SUZANO")).toBe(false);
    expect(effectiveCity("Salvador", "mogi_guacu")).toBe("Mogi Guaçu");
    expect(effectiveCity("Salvador", null)).toBe("Salvador");
  });
});

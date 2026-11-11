import { describe, expect, it } from "vitest";
import { entitledToFolga, folgaDaysBy, folgaWeekOf } from "./weekly-days-off";

describe("folga semanal", () => {
  it("usa a semana de segunda a domingo e o fim de semana anterior a ela", () => {
    // 11/11/2026 é quarta-feira
    const w = folgaWeekOf("2026-11-11");
    expect(w.saturday).toBe("2026-11-07");
    expect(w.sunday).toBe("2026-11-08");
    expect(w.days[0]).toBe("2026-11-09");
    expect(w.days[6]).toBe("2026-11-15");
    expect(w.window).toHaveLength(14);
    expect(w.window[13]).toBe("2026-11-22"); // a folga pode cair na semana seguinte
    expect(folgaWeekOf("2026-11-15")).toEqual(w); // domingo fica na mesma semana
    expect(folgaWeekOf("2026-11-09")).toEqual(w);
  });
  it("só tem direito quem trabalhou sábado e domingo", () => {
    expect(entitledToFolga({ saturday: ["a", "b", "b"], sunday: ["b", "c"] })).toEqual(["b"]);
  });
  it("marca os dias de folga da semana vindos do cadastro e da caixa FOLGAS", () => {
    const w = folgaWeekOf("2026-11-11");
    const m = folgaDaysBy(w,
      [{ collaborator_id: "a", date: "2026-11-10", end_date: null }, { collaborator_id: "b", date: "2026-11-01", end_date: "2026-11-09" }, { collaborator_id: "c", date: "2026-11-20", end_date: null }, { collaborator_id: "e", date: "2026-11-23", end_date: null }],
      [{ collaborator_id: "a", date: "2026-11-10" }, { collaborator_id: "d", date: "2026-11-13" }]);
    expect(m.get("a")).toEqual(["2026-11-10"]);
    expect(m.get("b")).toEqual(["2026-11-09"]);
    expect(m.get("c")).toEqual(["2026-11-20"]); // folga na semana seguinte também conta
    expect(m.has("e")).toBe(false); // fora das duas semanas
    expect(m.get("d")).toEqual(["2026-11-13"]);
  });
});

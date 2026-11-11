import { describe, expect, it } from "vitest";
import { plusMonths, upcomingAlongside } from "./training-batch";

const today = "2026-11-11";
const rec = (id: string, person: string, training: string, expires: string | null) => ({ id, collaborator_id: person, training_id: training, expires_at: expires });

describe("treinamentos que vencem junto", () => {
  it("avisa só os que vencem até 2 meses depois e ainda faltam mais de 30 dias", () => {
    const records = [
      rec("a1", "ana", "nr35", "2026-11-30"), // a vencer: âncora
      rec("a2", "ana", "nr10", "2027-01-15"), // 65 dias, dentro de 2 meses → avisa
      rec("a3", "ana", "nr18", "2026-12-05"), // 24 dias: já está em "A vencer" → não avisa
      rec("a4", "ana", "nr12", "2027-02-10"), // depois de 30/01 → fora
      rec("a5", "ana", "nr33", null), // sem validade
      rec("b1", "bia", "nr10", "2027-01-01"), // outra pessoa
    ];
    const m = upcomingAlongside(records, today);
    expect(m.get("a1")?.map((r) => r.id)).toEqual(["a2"]);
    expect(m.has("a3")).toBe(true); // a3 também é âncora e enxerga a2
    expect(m.has("a2")).toBe(false); // treinamento válido não ganha aviso
    expect(m.has("b1")).toBe(false);
  });
  it("ignora o que já está agendado ou em conferência", () => {
    const records = [rec("a1", "ana", "nr35", "2026-11-30"), rec("a2", "ana", "nr10", "2027-01-15")];
    expect(upcomingAlongside(records, today, (r) => r.training_id === "nr10").size).toBe(0);
  });
  it("usa só o registro mais recente de cada treinamento", () => {
    const records = [rec("a1", "ana", "nr35", "2026-11-30"), rec("old", "ana", "nr10", "2026-12-20"), rec("new", "ana", "nr10", "2028-12-20")];
    expect(upcomingAlongside(records, today).has("a1")).toBe(false);
  });
  it("soma meses respeitando o fim do mês", () => {
    expect(plusMonths("2026-11-30", 2)).toBe("2027-01-30");
    expect(plusMonths("2026-12-31", 2)).toBe("2027-02-28");
  });
});

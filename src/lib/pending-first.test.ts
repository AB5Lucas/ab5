import { describe, expect, it } from "vitest";
import { pendingFirst } from "./pending-first";

describe("pendentes primeiro", () => {
  it("vencidos e a vencer sem agendamento/conferência em cima; o resto em ordem alfabética", () => {
    const rows = [
      { id: "ok1", n: "Zeca", s: "valid", e: "2027-05-01", h: false },
      { id: "av2", n: "Bruno", s: "expiring", e: "2026-12-10", h: false },
      { id: "v1", n: "Xavier", s: "expired", e: "2026-10-01", h: false },
      { id: "ok2", n: "Ana", s: "valid", e: "2027-01-01", h: false },
      { id: "av1", n: "Carla", s: "expiring", e: "2026-11-20", h: false },
      { id: "vAg", n: "Beatriz", s: "expired", e: "2026-09-01", h: true }, // já agendado: vai para a ordem alfabética
      { id: "doc", n: "Mário", s: "documentation", e: "2026-09-01", h: false },
    ];
    const out = pendingFirst(rows, (r) => r.s, (r) => r.e, { handled: (r) => r.h, name: (r) => r.n });
    expect(out.map((r) => r.id)).toEqual(["v1", "av1", "av2", "ok2", "vAg", "doc", "ok1"]);
  });
});

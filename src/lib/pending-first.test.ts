import { describe, expect, it } from "vitest";
import { pendingFirst } from "./pending-first";

describe("pendentes primeiro", () => {
  it("vencidos, depois a vencer (por data), depois o resto na ordem original", () => {
    const rows = [
      { id: "ok1", s: "valid", e: "2027-05-01" },
      { id: "av2", s: "expiring", e: "2026-12-10" },
      { id: "v1", s: "expired", e: "2026-10-01" },
      { id: "ok2", s: "valid", e: "2027-01-01" },
      { id: "av1", s: "expiring", e: "2026-11-20" },
      { id: "doc", s: "documentation", e: "2026-09-01" },
    ];
    expect(pendingFirst(rows, (r) => r.s, (r) => r.e).map((r) => r.id)).toEqual(["v1", "av1", "av2", "ok1", "ok2", "doc"]);
  });
});

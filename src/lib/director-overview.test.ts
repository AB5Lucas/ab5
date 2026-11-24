import { describe, expect, it } from "vitest";
import { rdoCoverage } from "./director-overview";

describe("rdoCoverage", () => {
  it("conta serviço com MO escalada e RDO (RDO Geral cobre o cliente; internos fora)", () => {
    const wc = new Map([
      ["w1", { client_id: "c1", general: false, internal: false }],
      ["w2", { client_id: "c1", general: false, internal: false }],
      ["g1", { client_id: "c1", general: true, internal: false }],
      ["w3", { client_id: "c2", general: false, internal: false }],
      ["adm", { client_id: "c3", general: false, internal: true }],
    ]);
    const allocs = [
      { work_id: "w1", date: "2026-11-24", collaborator_id: "p1" },
      { work_id: "w2", date: "2026-11-24", collaborator_id: "p2" },
      { work_id: "w3", date: "2026-11-24", collaborator_id: "p3" },
      { work_id: "adm", date: "2026-11-24", collaborator_id: "p4" },
    ];
    const r = rdoCoverage(allocs, [{ work_id: "g1", report_date: "2026-11-24" }], wc);
    expect(r.expected).toBe(3);
    expect(r.done).toBe(2);
    expect(r.missing).toEqual([{ work_id: "w3", date: "2026-11-24" }]);
    expect(r.headcount).toBe(3);
  });
});

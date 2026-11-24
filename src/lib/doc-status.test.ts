import { describe, expect, it } from "vitest";
import { asoExpiry, cellStatus, docStatus, integrationExpiry, latestByKey, trainingExpiry } from "./doc-status";

describe("validade dos documentos", () => {
  it("vencimentos", () => {
    expect(asoExpiry("2026-01-15")).toBe("2027-01-14");
    expect(integrationExpiry("2026-01-15")).toBe("2027-01-14");
    expect(trainingExpiry("2026-01-15", 24)).toBe("2028-01-14");
    expect(trainingExpiry("2026-01-15", 0)).toBeNull();
    expect(trainingExpiry("2026-01-15", null)).toBeNull();
  });
  it("situação", () => {
    expect(docStatus(null, "2026-11-24")).toBe("valid");
    expect(docStatus("2026-11-23", "2026-11-24")).toBe("expired");
    expect(docStatus("2026-11-24", "2026-11-24")).toBe("expiring");
    expect(docStatus("2026-12-24", "2026-11-24")).toBe("expiring");
    expect(docStatus("2026-12-25", "2026-11-24")).toBe("valid");
  });
  it("registro mais recente (sem vencimento ganha)", () => {
    const m = latestByKey([{ k: "a", expires_at: "2026-01-01" }, { k: "a", expires_at: "2027-01-01" }, { k: "b", expires_at: "2026-01-01" }, { k: "b", expires_at: null }], (x) => x.k);
    expect(m.get("a")?.expires_at).toBe("2027-01-01");
    expect(m.get("b")?.expires_at).toBeNull();
  });
  it("célula da Liberação por cliente", () => {
    expect(cellStatus({ has: false, expires: null, today: "2026-11-24" })).toBe("missing");
    expect(cellStatus({ has: false, expires: null, today: "2026-11-24", scheduled: true })).toBe("scheduled");
    expect(cellStatus({ has: true, expires: "2026-01-01", today: "2026-11-24", conference: true })).toBe("conference");
    expect(cellStatus({ has: true, expires: "2027-11-01", today: "2026-11-24", scheduled: true })).toBe("valid");
  });
});

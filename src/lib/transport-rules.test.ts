import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { vtFor, workVtDefault } from "./transport-rules";
describe("VT em Serviços", () => {
  it("sem registro usa o VT cadastrado no cliente", () => {
    expect(workVtDefault(undefined, true)).toBe(true);
    expect(workVtDefault(undefined, false)).toBe(false);
  });
  it("preserva desligamento explícito", () => {
    expect(workVtDefault(false, true)).toBe(false);
  });
  it("transporte montado mantém VT apenas para transporte próprio", () => {
    const t = { built: new Set(["industry|2026-10-25"]), own: new Set(["industry|2026-10-25|own"]) };
    expect(vtFor(t, "industry", "2026-10-25", "own", false)).toBe(true);
    expect(vtFor(t, "industry", "2026-10-25", "passenger", true)).toBe(false);
    expect(vtFor(t, "industry", "2026-10-24", "passenger", true)).toBe(true);
  });
});
import { describe, expect, it } from "vitest";
import { oldestStanding, requestsByStage, scaffoldVolume, stockByPlace, weeklyProductivity } from "./andaimes";

const TODAY = "2026-11-24";

describe("estoque por local", () => {
  it("agrupa obra, Canteiro e locais fixos, com participação e transferências", () => {
    const places = stockByPlace(
      [
        { item_id: "i1", location: "central", quantity: 60, work_id: null, client_id: null },
        { item_id: "i2", location: "central", quantity: 20, work_id: null, client_id: null },
        { item_id: "i1", location: "obra", quantity: 15, work_id: "w1", client_id: "c1" },
        { item_id: "i1", location: "obra", quantity: 5, work_id: null, client_id: "c1" },
        { item_id: "i3", location: "danificado", quantity: 0, work_id: null, client_id: null },
      ],
      [{ created_at: "2026-11-22T10:00:00Z", quantity: 10, from_location: "central", to_location: "obra", from_work_id: null, to_work_id: "w1", from_client_id: null, to_client_id: "c1" }],
      { work: new Map([["w1", "Caldeira"]]), client: new Map([["c1", "Suzano"]]) },
    );
    expect(places.map((p) => [p.label, p.pieces, p.items])).toEqual([["Estoque central (Pátio)", 80, 2], ["Caldeira", 15, 1], ["Canteiro · Suzano", 5, 1]]);
    expect(places[0]!.share).toBeCloseTo(0.8);
    expect(places[0]!.movedOut).toBe(10);
    expect(places[1]!.movedIn).toBe(10);
  });
});

describe("montados há mais tempo", () => {
  it("só os de pé, do mais antigo", () => {
    const r = oldestStanding([
      { id: "a", status: "liberado", assembled_at: "2026-10-01", order_code: "1", location_desc: null, client_id: "c", work_id: null },
      { id: "b", status: "desmontado", assembled_at: "2026-01-01", order_code: "2", location_desc: null, client_id: "c", work_id: null },
      { id: "c", status: "montagem", assembled_at: null, order_code: "3", location_desc: null, client_id: "c", work_id: null },
      { id: "d", status: "liberado", assembled_at: "2026-11-20", order_code: "4", location_desc: null, client_id: "c", work_id: null },
    ], TODAY);
    expect(r.map((x) => [x.row.id, x.days])).toEqual([["a", 54], ["d", 4]]);
  });
});

describe("produtividade da semana", () => {
  it("soma m³ de montagem por encarregado e dia", () => {
    const row = (date: string, who: string | null, op = "montagem") => ({ operation: op, length_m: 2, width_m: 1, height_m: 3, quantity: 2, report_date: date, responsible: who });
    expect(scaffoldVolume(row(TODAY, "x"))).toBe(12);
    const p = weeklyProductivity([row(TODAY, "Ana"), row("2026-11-18", "Ana"), row(TODAY, "Bia", "desmontagem"), row("2026-11-17", "Ana"), row(TODAY, null)], TODAY);
    expect(p.days[0]).toBe("2026-11-18");
    expect(p.total).toBe(36);
    expect(p.teams.map((t) => [t.name, t.total])).toEqual([["Ana", 24], ["Sem responsável", 12]]);
    expect(p.teams[0]!.series).toEqual([12, 0, 0, 0, 0, 0, 12]);
  });
});

describe("solicitações por etapa", () => {
  it("conta por etapa, a mais antiga e as que esperam quem vê", () => {
    const s = requestsByStage([
      { id: "1", number: 1, flow_stage: "aguardando_aprovacao", updated_at: "2026-11-20T10:00:00Z", user_id: "u1" },
      { id: "2", number: 2, flow_stage: "aguardando_aprovacao", updated_at: "2026-11-23T10:00:00Z", user_id: "u1" },
      { id: "3", number: 3, flow_stage: "em_obra", updated_at: "2026-11-10T10:00:00Z", user_id: "me" },
    ], TODAY, (actor, r) => actor === "solicitante" && r.user_id === "me");
    const ap = s.find((x) => x.key === "aguardando_aprovacao")!;
    expect([ap.count, ap.oldestDays, ap.mine]).toEqual([2, 4, 0]);
    const ob = s.find((x) => x.key === "em_obra")!;
    expect([ob.count, ob.mine]).toEqual([1, 1]);
    expect(s.some((x) => x.key === "encerrada")).toBe(false);
  });
});

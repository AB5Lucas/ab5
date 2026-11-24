import { describe, expect, it } from "vitest";
import { budgetVsBought, flowStage, leadTimeTrend, stageSummary, urgentQueue, type ScLike } from "./purchases";

const TODAY = "2026-11-24";
const sc = (o: Partial<ScLike> & { id: string }): ScLike => ({
  number: `SC-${o.id}`, stage: "compras", status: "EM ANDAMENTO", status_at: TODAY, created_at: "2026-11-01T10:00:00Z",
  sent_at: "2026-11-10T10:00:00Z", approved_at: null, due_date: null, client_id: "c1", approver_id: null, substitute_id: null,
  requester_name: "Ana", total_budget: null, ...o,
});

describe("etapas", () => {
  it("classifica pela etapa e status", () => {
    expect(flowStage(sc({ id: "1", stage: "rascunho" }))).toBe("rascunho");
    expect(flowStage(sc({ id: "1", stage: "aprovacao" }))).toBe("validacao");
    expect(flowStage(sc({ id: "1" }))).toBe("compras");
    expect(flowStage(sc({ id: "1", status: "ALMOXARIFADO" }))).toBe("comprada");
    expect(flowStage(sc({ id: "1", status: "CANCELADA", stage: "cancelada" }))).toBe("encerrada");
  });
  it("conta e acha a mais antiga parada", () => {
    const s = stageSummary([
      sc({ id: "a", stage: "aprovacao", sent_at: "2026-11-18T09:00:00Z" }),
      sc({ id: "b", stage: "aprovacao", sent_at: "2026-11-20T09:00:00Z" }),
      sc({ id: "c", status: "COMPRA EFETIVADA", status_at: "2026-10-30" }), // comprada em outro mês: fora
      sc({ id: "d", status: "COMPRA EFETIVADA", status_at: "2026-11-22" }),
    ], TODAY);
    const v = s.find((x) => x.key === "validacao")!;
    expect(v.count).toBe(2);
    expect(v.oldest?.row.id).toBe("a");
    expect(v.oldest?.days).toBe(6);
    expect(s.find((x) => x.key === "comprada")!.count).toBe(1);
  });
});

describe("fila por prazo", () => {
  it("ordena pelo prazo, esvazia a barra e marca atrasadas", () => {
    const q = urgentQueue([
      sc({ id: "late", due_date: "2026-11-20" }),
      sc({ id: "mid", due_date: "2026-11-28" }),
      sc({ id: "done", due_date: "2026-11-15", status: "COMPRA EFETIVADA" }),
      sc({ id: "draft", due_date: "2026-11-15", stage: "rascunho", sent_at: null }),
      sc({ id: "nodue" }),
    ], TODAY);
    expect(q.map((x) => x.row.id)).toEqual(["late", "mid"]);
    expect(q[0]!.late).toBe(true);
    expect(q[0]!.fractionLeft).toBe(0);
    expect(q[1]!.daysLeft).toBe(4);
    expect(q[1]!.fractionLeft).toBeCloseTo(4 / 18);
  });
});

describe("tempo de compra", () => {
  it("média do mês × anterior", () => {
    const t = leadTimeTrend([
      sc({ id: "1", status: "COMPRA EFETIVADA", sent_at: "2026-11-10T08:00:00Z", status_at: "2026-11-14" }),
      sc({ id: "2", status: "COMPRA EFETIVADA", sent_at: "2026-11-10T08:00:00Z", status_at: "2026-11-16" }),
      sc({ id: "3", status: "COMPRA EFETIVADA", sent_at: "2026-10-01T08:00:00Z", status_at: "2026-10-09" }),
      sc({ id: "4", status: "ALMOXARIFADO", sent_at: "2026-11-01T08:00:00Z", status_at: "2026-11-20" }),
    ], TODAY);
    expect(t.current).toEqual({ count: 2, avg: 5 });
    expect(t.previous.avg).toBe(8);
    expect(t.delta).toBe(-3);
  });
});

describe("verba × comprado", () => {
  it("soma verba dos itens e a comprada por cliente", () => {
    const rows = [
      sc({ id: "1", client_id: "c1" }),
      sc({ id: "2", client_id: "c2", total_budget: 1000, status: "COMPRA EFETIVADA" }),
      sc({ id: "3", client_id: "c1", total_budget: 500 }),
      sc({ id: "4", client_id: "c1", total_budget: 900, status: "CANCELADA" }),
      sc({ id: "5", client_id: "c1", total_budget: 900, sent_at: "2026-10-01T00:00:00Z" }),
    ];
    const items = [
      { request_id: "1", budget: 100, status: "COMPRADO" },
      { request_id: "1", budget: 300, status: "COTAR" },
      { request_id: "1", budget: 50, status: "CANCELADO" },
      { request_id: "3", budget: null, status: "ALMOXARIFADO" },
      { request_id: "3", budget: null, status: "COTAR" },
    ];
    expect(budgetVsBought(rows, items, "2026-11")).toEqual([
      { clientId: "c2", budget: 1000, bought: 1000 },
      { clientId: "c1", budget: 900, bought: 350 },
    ]);
  });
});

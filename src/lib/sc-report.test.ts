import { describe, expect, it } from "vitest";
import { buildScReport, type ScReportParams } from "./sc-report";

const base: ScReportParams = { from: "", to: "", show: "abertas", requester: "all", category: "all", system: "all", group: "nenhum", sort: "prazo_asc" };
const req = (id: string, extra: Record<string, unknown> = {}) => ({ id, number: `SC-${id}`, request_date: "2026-11-10", requester_id: "u1", requester_name: "ALEX", system: "PLANILHA", category: "EPI", nature: "PONTUAL", client_id: "c", due_date: "2026-11-30", status: "SOLICITAÇÃO ENVIADA", status_at: "2026-11-10", sent_at: "2026-11-10", ...extra });
const ctx = { clientName: () => "MARS", workName: () => "Serviço", ccOf: () => "2004999" };

describe("relação de SCs", () => {
  it("em aberto lista só os itens pendentes; TOTVS sem itens vira uma linha", () => {
    const items = [
      { request_id: "a", item_no: 1, quantity: 2, unit: "UN", description: "Luva", budget: 10, work_id: null, cc_code: null, status: "COTAR" },
      { request_id: "a", item_no: 2, quantity: 1, unit: "UN", description: "Bota", budget: 50, work_id: null, cc_code: null, status: "COMPRADO" },
    ];
    const g = buildScReport([req("a"), req("b", { system: "TOTVS", due_date: "2026-11-20" })], items, base, "2026-11-19", ctx);
    expect(g[0]!.rows.map((r) => [r.number, r.item])).toEqual([["SC-b", "—"], ["SC-a", "1"]]);
    expect(buildScReport([req("a")], items, { ...base, show: "concluidas" }, "2026-11-19", ctx)[0]!.rows.map((r) => r.item)).toEqual(["2"]);
  });
  it("agrupa e filtra por emissão", () => {
    const g = buildScReport([req("a"), req("b", { requester_name: "BRUNO", request_date: "2026-10-01" })], [], { ...base, show: "todas", group: "solicitante", from: "2026-11-01" }, "2026-11-19", ctx);
    expect(g.map((x) => x.group)).toEqual(["ALEX"]);
  });
});

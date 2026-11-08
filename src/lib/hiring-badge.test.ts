import { describe, expect, it } from "vitest";
import { hiringBadge } from "./hiring-badge";

describe("indicador de Contratações", () => {
  it("fica vermelho se alguma solicitação estiver aberta", () => {
    expect(hiringBadge([{ status: "aberta" }, { status: "processo" }])).toEqual({ count: 2, tone: "red" });
  });
  it("fica laranja quando todas as pendentes já têm andamento", () => {
    expect(hiringBadge(["analise", "aguardando", "processo", "parcial"].map((status) => ({ status })))).toEqual({ count: 4, tone: "orange" });
  });
  it("não conta atendidas e canceladas como pendências", () => {
    expect(hiringBadge([{ status: "atendida" }, { status: "cancelada" }])).toBeUndefined();
  });
});
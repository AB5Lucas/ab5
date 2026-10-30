import { describe, expect, it } from "vitest";
import { mergePendingClients, serviceDistribution, twoWeekRange, type DistributionWork } from "./service-distribution";

const works: DistributionWork[] = [
  { id: "a1", client_id: "a", active: true },
  { id: "a2", client_id: "a", active: true },
  { id: "a3", client_id: "a", active: false },
  { id: "b1", client_id: "b", active: true },
  { id: "b2", client_id: "b", active: false },
  { id: "c1", client_id: "c", active: true },
  { id: "c2", client_id: "c", active: true },
];
const allocation = (work_id: string, service_assigned: boolean, collaborator_id = "person") => ({ work_id, service_assigned, collaborator_id });

describe("indicadores de Serviços", () => {
  it("conta cada cliente não distribuído uma única vez", () => {
    expect(serviceDistribution(works, [allocation("a1", false), allocation("a2", false, "other"), allocation("c1", false)]).pendingClients).toBe(2);
  });
  it("considera apenas clientes com mais de um serviço ativo", () => {
    expect(serviceDistribution(works, [allocation("b1", false)]).pendingClients).toBe(0);
  });
  it("não conta clientes sem efetivo ou totalmente distribuídos", () => {
    expect(serviceDistribution(works, [allocation("a1", true)]).pendingClients).toBe(0);
  });
  it("sinaliza somente clientes com efetivo ainda não distribuído", () => {
    expect(serviceDistribution(works, [allocation("a1", false), allocation("a2", true)]).pendingClientIds).toEqual(["a"]);
  });
  it("não sinaliza serviços vazios quando todo o efetivo do cliente está distribuído", () => {
    expect(serviceDistribution(works, [allocation("a1", true)]).pendingClientIds).toEqual([]);
  });
  it("ignora pessoas indisponíveis, como os quadros de Serviços", () => {
    const result = serviceDistribution(works, [allocation("a1", false), allocation("a2", true)], new Set(["person"]));
    expect(result.pendingClients).toBe(0);
    expect(result.pendingClientIds).toEqual([]);
  });
});
describe("indicador semanal de Serviços", () => {
  it("cobre da segunda atual ao domingo da próxima semana", () => {
    expect(twoWeekRange("2026-10-30")).toEqual({ start: "2026-10-26", end: "2026-11-08" });
    expect(twoWeekRange("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-08" });
  });
  it("cliente pendente em vários dias conta só uma vez", () => {
    expect(mergePendingClients([{ pendingClientIds: ["ind"] }, { pendingClientIds: ["ind", "x"] }]).pendingClients).toBe(2);
  });
});

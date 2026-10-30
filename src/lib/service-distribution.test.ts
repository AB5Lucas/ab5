import { describe, expect, it } from "vitest";
import { serviceDistribution, type DistributionWork } from "./service-distribution";

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
  it("conta serviços ativos vazios, sem tratar efetivo não distribuído como alocação de serviço", () => {
    expect(serviceDistribution(works, [allocation("a1", false), allocation("a2", true)]).emptyByClient).toEqual({ a: 1, b: 1, c: 2 });
  });
  it("remove a bolinha quando todos os serviços ativos têm alocação", () => {
    expect(serviceDistribution(works, [allocation("a1", true), allocation("a2", true)]).emptyByClient.a).toBe(0);
  });
  it("ignora pessoas indisponíveis, como os quadros de Serviços", () => {
    const result = serviceDistribution(works, [allocation("a1", false), allocation("a2", true)], new Set(["person"]));
    expect(result.pendingClients).toBe(0);
    expect(result.emptyByClient.a).toBe(2);
  });
});
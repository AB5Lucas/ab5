import { describe, expect, it } from "vitest";
import { resultWorksForRole } from "./result-work-access";

const works = [
  { id: "premix", client_id: "MARS MM" },
  { id: "locacao", client_id: "MARS MM" },
  { id: "outro-cliente", client_id: "MARS GUA" },
  { id: "sem-cliente", client_id: null },
];
const assignments = [{ work_id: "premix", works: { client_id: "MARS MM" } }];

describe("coordinator result scope", () => {
  it("includes new MARS MM services without individual assignment for every coordinator", () => {
    expect(resultWorksForRole(works, "coordenador", assignments).map((w) => w.id)).toEqual(["premix", "locacao"]);
  });
  it("does not include services from unauthorized clients", () => {
    expect(resultWorksForRole(works, "coordenador", assignments).some((w) => w.id === "outro-cliente")).toBe(false);
  });
  it("does not give unassigned coordinators any services", () => {
    expect(resultWorksForRole(works, "coordenador", [])).toEqual([]);
  });
  it("keeps Cliente access limited to individual assigned services", () => {
    expect(resultWorksForRole(works, "cliente", assignments).map((w) => w.id)).toEqual(["premix"]);
  });
});
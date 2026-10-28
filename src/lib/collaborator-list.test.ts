import { describe, expect, it } from "vitest";
import { collaboratorNamesText, matchesPositions } from "./collaborator-list";

describe("collaborator list", () => {
  const rows = [
    { full_name: "Ana Silva", social_name: null, position_id: "montador" },
    { full_name: "João Souza", social_name: null, position_id: "pintor" },
    { full_name: "Maria Lima", social_name: null, position_id: "soldador" },
  ];
  const positions = new Map([["montador", "Montador"], ["pintor", "Pintor"]]);

  it("includes either selected function and excludes unselected functions", () => {
    expect(rows.filter((row) => matchesPositions(row.position_id, ["montador", "pintor"])).map((row) => row.full_name))
      .toEqual(["Ana Silva", "João Souza"]);
    expect(matchesPositions("soldador", [])).toBe(true);
    expect(matchesPositions(null, ["__none__"])).toBe(true);
  });

  it("copies only names when selected", () => {
    expect(collaboratorNamesText(rows.slice(0, 2), positions, false)).toBe("Ana Silva\nJoão Souza");
  });

  it("copies names and their functions when selected", () => {
    expect(collaboratorNamesText(rows.slice(0, 2), positions, true)).toBe("Ana Silva — Montador\nJoão Souza — Pintor");
  });
});
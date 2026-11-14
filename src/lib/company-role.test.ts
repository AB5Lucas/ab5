import { describe, expect, it } from "vitest";
import { companyRole, positionWithoutLevel } from "./company-role";

const people = [
  { full_name: "Matheus Fernando Quirino", active: true, position: "Montador de Andaime N3" },
  { full_name: "Matheus Jonathan Braz de Viveiros", active: true, position: "Tecnico de Segurança do Trabalho N2" },
  { full_name: "Marcelo Barrella Martin", active: true, position: "Sócio Proprietário" },
  { full_name: "Marcelo Henrique Nery de Carvalho", active: true, position: "Analista de Processos N3" },
  { full_name: "Yasmin Aparecida Correa", active: true, position: "Auxiliar Administrativo N1" },
  { full_name: "Jaco de Souza Abrantes", active: true, position: "Encarregado de Obras" },
];

describe("função na empresa", () => {
  it("tira o nível", () => {
    expect(positionWithoutLevel("Montador de Andaime N3")).toBe("Montador de Andaime");
    expect(positionWithoutLevel("Sócio Proprietário")).toBe("Sócio Proprietário");
  });
  it("casa nome curto, acento e sobrenome do meio", () => {
    expect(companyRole("Matheus Braz", people)).toBe("Tecnico de Segurança do Trabalho");
    expect(companyRole("Marcelo Carvalho", people)).toBe("Analista de Processos");
    expect(companyRole("Yasmin Corrêa", people)).toBe("Auxiliar Administrativo");
    expect(companyRole("Jacó Abrantes", people)).toBe("Encarregado de Obras");
  });
  it("sem casamento único, nada", () => {
    expect(companyRole("Marcelo", people)).toBeNull();
    expect(companyRole("Daniela Faria", people)).toBeNull();
  });
});

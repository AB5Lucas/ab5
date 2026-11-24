import { matchDriverName } from "@/lib/fleet-notes";

/**
 * Função na empresa do usuário logado, para o rodapé do menu: o usuário também está em Colaboradores, mas pode ter se
 * cadastrado só com primeiro e segundo nome ("Matheus Braz" = "Matheus Jonathan Braz de Viveiros"). O nome é casado como
 * na Liberação do posto (primeiro nome + demais palavras, sem acento, 1 letra de erro), primeiro entre os ativos; só vale
 * se um único colaborador combinar. O nível do cargo (N1…N4) não aparece.
 */
export type RoleCollaborator = { full_name: string; active: boolean; position: string | null };

export const positionWithoutLevel = (p: string | null | undefined) =>
  (p ?? "").replace(/\s*[-–]?\s*\b(N\s?\d+|n[ií]vel\s*\d+|[IVX]{1,4})\s*$/i, "").trim() || null;

/** Colaborador casado com o nome do usuário (único), ou null. Serve para quem lê só nome/situação e busca o cargo depois. */
export function companyRoleMatch<T extends { full_name: string; active: boolean }>(profileName: string | null | undefined, people: T[]): T | null {
  if (!profileName?.trim()) return null;
  const active = people.filter((p) => p.active).map((p) => p.full_name);
  const name = matchDriverName(profileName, active, people.map((p) => p.full_name));
  if (!name) return null;
  return people.find((p) => p.full_name === name && p.active) ?? people.find((p) => p.full_name === name) ?? null;
}

export function companyRole(profileName: string | null | undefined, people: RoleCollaborator[]): string | null {
  const hit = companyRoleMatch(profileName, people);
  return hit ? positionWithoutLevel(hit.position) : null;
}

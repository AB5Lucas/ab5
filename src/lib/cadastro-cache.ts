import type { QueryClient } from "@tanstack/react-query";

/**
 * Cadastros (colaboradores, serviços, clientes, catálogos) usados pelos avisos do menu e da Programação.
 * Ficam numa consulta própria (chave ["cadastro", nome]) com 5 min de validade: os avisos são relidos depois de qualquer
 * gravação (MutationCache em router.tsx), mas só os dados do dia voltam ao banco; os cadastros só são relidos depois de
 * 5 min ou quando uma tela de cadastro invalida ["cadastro"].
 */
export const CADASTRO_KEY = ["cadastro"] as const;
export const CADASTRO_STALE_MS = 5 * 60_000;

export function readCadastro<T>(qc: QueryClient | undefined, name: string, fn: () => Promise<T>): Promise<T> {
  if (!qc) return fn();
  return qc.fetchQuery({ queryKey: [...CADASTRO_KEY, name], queryFn: fn, staleTime: CADASTRO_STALE_MS, gcTime: CADASTRO_STALE_MS });
}

import type { QueryClient } from "@tanstack/react-query";

/**
 * Consultas que dependem de ausências (folgas, férias, atestados) e da escala do dia: Programação (contexto, dia, alocações,
 * quadros), aba Serviços, Folgas da semana, Fechamento, painel e avisos. Usado no lugar de `invalidateQueries()` sem chave,
 * que relia todas as consultas abertas (inclusive cadastros e relatórios pesados) a cada lançamento.
 */
const DAY_KEYS: readonly (readonly string[])[] = [
  ["schedule-ctx"], ["schedule"], ["allocations"], ["status-entries"], ["rdo-absence-origin"], ["appointments-day"],
  ["servicos-day"], ["day-absences"], ["servicos-weekend-ctx"], ["weekly-folgas"], ["closing"], ["dashboard"], ["report-allocations"],
  ["days_off"], ["vacations"], ["medical_leaves"],
  ["menu-badges"], ["schedule-alerts"], ["service-distribution"],
];

export function invalidateScheduleDay(qc: QueryClient) {
  for (const queryKey of DAY_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
}

/** Cadastro de colaboradores mudou: listas de pessoas (chaves com "collab", "people" ou "driver", ex.: collaborators,
 * collaborators-min, timeline-people, fleet-cnh-people, drivers), cadastros dos avisos (["cadastro"]), quem recebe prêmio
 * viagem e o que depende da escala. Só as consultas abertas na tela são relidas na hora. */
export function invalidateCollaborators(qc: QueryClient) {
  void qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === "string" && (/collab|people|driver/.test(k) || ["cadastro", "company-role", "travel-info", "lodging-stays", "prize-hours"].includes(k));
    },
  });
  invalidateScheduleDay(qc);
}

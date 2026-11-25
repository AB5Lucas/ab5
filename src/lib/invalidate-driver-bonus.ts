import type { QueryClient } from "@tanstack/react-query";

/** Refresh live calculations only; persisted adjustments and records are untouched. */
export async function invalidateDriverBonus(queryClient: QueryClient) {
  await Promise.all([
    ["db-rules"], ["driver-bonus-calc-v3"], ["closing"], ["work-result"], ["hh-budget-refs-v2"], ["fin-shared"],
  ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  // Financial raw rows embed shared rules: refresh only after the shared input has been reloaded.
  await queryClient.invalidateQueries({ queryKey: ["fin-client-raw"] });
}
import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { invalidateDriverBonus } from "./invalidate-driver-bonus";

it("invalidates all cached bonus months and dependent live calculations without touching unrelated records", async () => {
  const client = new QueryClient();
  const affected = [["db-rules"], ["driver-bonus-calc-v3", "2026-10"], ["driver-bonus-calc-v3", "2026-11"], ["closing", "2026-11"], ["work-result", "service"], ["hh-budget-refs-v2", "client"], ["fin-shared"], ["fin-client-raw", "client", "2026-11"]];
  for (const key of [...affected, ["closing-adjustments"], ["fleet-expenses"]]) client.setQueryData(key, 1);
  await invalidateDriverBonus(client);
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["closing-adjustments"])?.isInvalidated).toBe(false);
  expect(client.getQueryState(["fleet-expenses"])?.isInvalidated).toBe(false);
  client.clear();
});
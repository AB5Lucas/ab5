import { AsyncLocalStorage } from "node:async_hooks";
type BackgroundContext = { waitUntil?: (promise: Promise<unknown>) => void };
export const billingExecution = new AsyncLocalStorage<BackgroundContext>();
export function deferBilling(task: Promise<unknown>): boolean {
  const context = billingExecution.getStore();
  if (!context?.waitUntil) return false;
  context.waitUntil(task);
  return true;
}
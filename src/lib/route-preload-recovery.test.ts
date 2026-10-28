import { describe, expect, it, vi } from "vitest";
import { createPreloadRecoveryHandler } from "./route-preload-recovery";

describe("route preload recovery", () => {
  it.each([true, false])("preserves the import rejection when reload returns %s", async (reloadResult) => {
    const reload = vi.fn(() => reloadResult);
    const target = new EventTarget();
    target.addEventListener("vite:preloadError", createPreloadRecoveryHandler(reload));
    const originalError = new Error("Failed to fetch dynamically imported module");
    // Vite only rethrows the original error when its event is not canceled.
    const importer = Promise.reject(originalError).catch((error) => {
      const event = new Event("vite:preloadError", { cancelable: true });
      target.dispatchEvent(event);
      if (!event.defaultPrevented) throw error;
    });

    await expect(importer).rejects.toBe(originalError);
    expect(reload).toHaveBeenCalledOnce();
  });
});
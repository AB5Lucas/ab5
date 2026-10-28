// Do not cancel vite:preloadError: cancellation turns a failed import into
// a fulfilled promise containing undefined, which breaks TanStack lazy routes.
export function createPreloadRecoveryHandler(reload: () => unknown) {
  return (_event: Event) => {
    reload();
  };
}
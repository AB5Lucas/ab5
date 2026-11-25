/** Shared dashboard loading state; uses the same motion and theme tokens as Results. */
export function DashboardSkeleton({ label = "Carregando dashboard" }: { label?: string }) {
  return <div role="status" aria-label={label} className="flex min-h-0 flex-1 flex-col gap-3">
    <span className="sr-only">{label}…</span>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="result-skeleton h-[13.25rem] rounded-2xl border bg-card p-4">
        <div className="h-3 w-28 rounded bg-muted" /><div className="mt-6 h-9 w-40 max-w-full rounded bg-muted" />
        <div className="mt-8 flex h-16 items-end gap-2">{[35, 65, 45, 80, 55, 90, 70].map((h, j) => <span key={j} className={`flex-1 rounded-sm bg-muted result-skeleton-bar-${h}`} />)}</div>
      </div>)}
    </div>
    <div className="grid min-h-72 flex-1 gap-3 md:grid-cols-2">
      {[0, 1].map((i) => <div key={i} className="result-skeleton min-h-72 rounded-2xl border bg-card p-4">
        <div className="h-3 w-36 rounded bg-muted" />
        <div className="mt-6 flex h-52 items-end gap-3">{[35, 65, 45, 80, 55, 90, 70, 50].map((h, j) => <span key={j} className={`flex-1 rounded-sm bg-muted result-skeleton-bar-${h}`} />)}</div>
      </div>)}
    </div>
  </div>;
}
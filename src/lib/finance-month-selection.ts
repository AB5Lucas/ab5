/** A click is a one-month range; dragging extends it in either direction. */
export function financeMonthRange(anchor: number, end = anchor): number[] {
  const first = Math.max(1, Math.min(anchor, end));
  const last = Math.min(12, Math.max(anchor, end));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}
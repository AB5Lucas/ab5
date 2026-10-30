export type CopyWork = { id: string; name: string; client_id: string | null; clients: { name: string } | null };
export type CopyAllocation = { work_id: string; works: CopyWork | null };

export function copyBoxKey(row: CopyAllocation) {
  return row.works?.client_id ?? row.work_id;
}

export function copyBoxes(rows: readonly CopyAllocation[]) {
  const boxes = new Map<string, { key: string; label: string; count: number }>();
  for (const row of rows) {
    const key = copyBoxKey(row);
    const box = boxes.get(key) ?? { key, label: row.works?.clients?.name ?? row.works?.name ?? "Obra", count: 0 };
    box.count++;
    boxes.set(key, box);
  }
  return [...boxes.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function selectedCopyRows<T extends CopyAllocation>(rows: readonly T[], selected: ReadonlySet<string>) {
  return rows.filter((row) => selected.has(copyBoxKey(row)));
}
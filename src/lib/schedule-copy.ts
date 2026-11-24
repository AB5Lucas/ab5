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
/** Verificações do "Copiar dia" por pessoa (cada uma devolve o detalhe do motivo ou nada). */
export type CopySkipChecks = {
  absence: (collaboratorId: string) => string | null | undefined;
  appointment: (collaboratorId: string) => string | null | undefined;
  docs: (row: { work_id: string; collaborator_id: string }) => string[];
  box: (collaboratorId: string) => string | null | undefined;
  noticeEnded: (collaboratorId: string) => string | null | undefined;
};

/** Motivo de uma pessoa do dia de origem não ser copiada (null = pode copiar). Mesma ordem das checagens da Programação. */
export function copySkipReason(row: { work_id: string; collaborator_id: string }, ch: CopySkipChecks): string | null {
  const id = row.collaborator_id;
  const abs = ch.absence(id);
  if (abs) return `ausência (${abs.toLowerCase()})`;
  const appt = ch.appointment(id);
  if (appt) return `agendamento (${appt})`;
  const box = ch.box(id);
  if (box) return `quadro ${box}`;
  const notice = ch.noticeEnded(id);
  if (notice) return `aviso prévio terminou em ${notice}`;
  const docs = ch.docs(row);
  if (docs.length) return `ASO/treinamento: ${docs.join(", ")}`;
  return null;
}

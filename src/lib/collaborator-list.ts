type ListCollaborator = {
  full_name: string;
  social_name?: string | null;
  position_id: string | null;
};

export function matchesPositions(positionId: string | null, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(positionId ?? "__none__");
}

export function collaboratorNamesText(
  rows: ListCollaborator[],
  positions: Map<string, string>,
  includePosition: boolean,
): string {
  return rows.map((row) => {
    const name = row.social_name || row.full_name;
    if (!includePosition) return name;
    const position = row.position_id ? positions.get(row.position_id) : undefined;
    return `${name} — ${position ?? "Sem função"}`;
  }).join("\n");
}
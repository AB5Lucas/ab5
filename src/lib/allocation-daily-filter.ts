/** Filtro puro das alocações diárias de uma pessoa (sem jsPDF), usado pela tabela e pelo PDF do Relatório de Alocações. */
type DailyAllocation = {
  collaborator_id: string | null;
  daily_schedules: { schedule_date: string } | null;
};

export function filteredDailyAllocations<T extends DailyAllocation>(rows: T[], person: string) {
  return rows.filter((row) => row.collaborator_id === person)
    .sort((a, b) => (a.daily_schedules?.schedule_date ?? "").localeCompare(b.daily_schedules?.schedule_date ?? ""));
}

type BudgetItem = { key: string; budget: number; real: number; used: number };

/** Monthly budgets are already period-specific and must not be scaled by progress. */
export function displayedBudgetItems<T extends BudgetItem>(items: T[], progress: number, monthlyBudget?: Record<string, number>) {
  return items.map((item) => {
    const budget = monthlyBudget ? monthlyBudget[item.key] ?? 0 : item.budget * progress;
    return { ...item, budget, used: budget ? (item.real / budget) * 100 : item.real ? 100 : 0 };
  });
}